-- ============================================================================
-- CONSTANCCE 1.1.23 — SYNC V3 / MULTI-DISPOSITIVO ATÔMICO
-- Execute UMA VEZ no Supabase SQL Editor ANTES de publicar domain-sync 1.1.23.
-- Preserva device_sync e constancce_domain_sync para compatibilidade/migração.
-- ============================================================================

begin;

create table if not exists public.constancce_sync_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  revision bigint not null default 0 check (revision >= 0),
  field_revisions jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.constancce_sync_mutations (
  user_id uuid not null references auth.users(id) on delete cascade,
  mutation_id text not null,
  client_id text,
  changed_keys text[] not null default '{}'::text[],
  applied_revision bigint not null,
  created_at timestamptz not null default now(),
  primary key (user_id, mutation_id)
);

create index if not exists constancce_sync_mutations_user_created_idx
  on public.constancce_sync_mutations(user_id, created_at desc);

alter table public.constancce_sync_state enable row level security;
alter table public.constancce_sync_mutations enable row level security;

-- O frontend não escreve nem lê diretamente essas tabelas. Todo acesso passa pela
-- Edge Function domain-sync autenticada, que usa service_role no servidor.
revoke all on table public.constancce_sync_state from public, anon, authenticated;
revoke all on table public.constancce_sync_mutations from public, anon, authenticated;

create or replace function public.constancce_apply_sync_patch(
  p_user_id uuid,
  p_patch jsonb,
  p_changed_keys text[],
  p_mutation_id text,
  p_client_id text,
  p_base_field_revisions jsonb default '{}'::jsonb
)
returns table(
  applied boolean,
  duplicate boolean,
  conflict boolean,
  conflicting_keys text[],
  revision bigint,
  field_revisions jsonb,
  data jsonb,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.constancce_sync_state%rowtype;
  v_existing_revision bigint;
  v_conflicts text[] := '{}'::text[];
  v_key text;
  v_expected bigint;
  v_current bigint;
  v_next_revision bigint;
  v_data jsonb;
  v_field_revisions jsonb;
begin
  if p_user_id is null or coalesce(trim(p_mutation_id), '') = '' then
    raise exception 'invalid_sync_request';
  end if;

  select m.applied_revision into v_existing_revision
  from public.constancce_sync_mutations m
  where m.user_id = p_user_id and m.mutation_id = p_mutation_id;

  if found then
    select * into v_state from public.constancce_sync_state where user_id = p_user_id;
    return query select true, true, false, '{}'::text[], v_state.revision,
      v_state.field_revisions, v_state.data, v_state.updated_at;
    return;
  end if;

  insert into public.constancce_sync_state(user_id, data, revision, field_revisions, updated_at)
  values (p_user_id, '{}'::jsonb, 0, '{}'::jsonb, now())
  on conflict (user_id) do nothing;

  select * into v_state
  from public.constancce_sync_state
  where user_id = p_user_id
  for update;

  -- Reconfere depois de adquirir o lock para garantir idempotência mesmo se o
  -- mesmo mutation_id chegar simultaneamente por pagehide + debounce.
  select m.applied_revision into v_existing_revision
  from public.constancce_sync_mutations m
  where m.user_id = p_user_id and m.mutation_id = p_mutation_id;
  if found then
    return query select true, true, false, '{}'::text[], v_state.revision,
      v_state.field_revisions, v_state.data, v_state.updated_at;
    return;
  end if;

  foreach v_key in array coalesce(p_changed_keys, '{}'::text[]) loop
    v_expected := coalesce((p_base_field_revisions ->> v_key)::bigint, 0);
    v_current := coalesce((v_state.field_revisions ->> v_key)::bigint, 0);
    if v_current > v_expected then
      v_conflicts := array_append(v_conflicts, v_key);
    end if;
  end loop;

  if cardinality(v_conflicts) > 0 then
    return query select false, false, true, v_conflicts, v_state.revision,
      v_state.field_revisions, v_state.data, v_state.updated_at;
    return;
  end if;

  v_next_revision := v_state.revision + 1;
  v_data := v_state.data;
  v_field_revisions := v_state.field_revisions;

  if p_patch ? 'schemaVersion' then
    v_data := jsonb_set(v_data, array['schemaVersion'], p_patch -> 'schemaVersion', true);
  end if;

  foreach v_key in array coalesce(p_changed_keys, '{}'::text[]) loop
    if p_patch ? v_key then
      v_data := jsonb_set(v_data, array[v_key], p_patch -> v_key, true);
      v_field_revisions := jsonb_set(v_field_revisions, array[v_key], to_jsonb(v_next_revision), true);
    end if;
  end loop;

  update public.constancce_sync_state
  set data = v_data,
      revision = v_next_revision,
      field_revisions = v_field_revisions,
      updated_at = now()
  where user_id = p_user_id
  returning * into v_state;

  insert into public.constancce_sync_mutations(
    user_id, mutation_id, client_id, changed_keys, applied_revision, created_at
  ) values (
    p_user_id, p_mutation_id, nullif(p_client_id,''), coalesce(p_changed_keys,'{}'::text[]), v_state.revision, now()
  ) on conflict (user_id, mutation_id) do nothing;

  return query select true, false, false, '{}'::text[], v_state.revision,
    v_state.field_revisions, v_state.data, v_state.updated_at;
end;
$$;

revoke all on function public.constancce_apply_sync_patch(uuid,jsonb,text[],text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.constancce_apply_sync_patch(uuid,jsonb,text[],text,text,jsonb)
  to service_role;

-- Mantém o ledger sob controle. Retenção operacional de 30 dias é suficiente para
-- idempotência de clientes e evita crescimento infinito.
create or replace function public.constancce_cleanup_sync_mutations()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare v_count bigint;
begin
  delete from public.constancce_sync_mutations where created_at < now() - interval '30 days';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.constancce_cleanup_sync_mutations() from public, anon, authenticated;
grant execute on function public.constancce_cleanup_sync_mutations() to service_role;

commit;
