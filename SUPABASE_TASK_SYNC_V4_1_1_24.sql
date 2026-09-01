-- ============================================================================
-- CONSTANCCE 1.1.24 — TASK SYNC V4 / TAREFAS ATÔMICAS POR ITEM
-- Execute UMA VEZ antes de publicar domain-sync 1.1.24.
-- Não apaga dados. A primeira leitura da Edge Function importa as tarefas do
-- snapshot legado para esta tabela quando necessário.
-- ============================================================================

begin;

create table if not exists public.constancce_tasks (
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id text not null,
  payload jsonb not null default '{}'::jsonb,
  revision bigint not null default 1 check (revision >= 1),
  deleted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, task_id)
);

create index if not exists constancce_tasks_user_updated_idx
  on public.constancce_tasks(user_id, updated_at desc);

create table if not exists public.constancce_task_mutations (
  user_id uuid not null references auth.users(id) on delete cascade,
  mutation_id text not null,
  client_id text,
  operations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, mutation_id)
);

alter table public.constancce_tasks enable row level security;
alter table public.constancce_task_mutations enable row level security;
revoke all on table public.constancce_tasks from public, anon, authenticated;
revoke all on table public.constancce_task_mutations from public, anon, authenticated;

create or replace function public.constancce_apply_task_ops(
  p_user_id uuid,
  p_mutation_id text,
  p_client_id text,
  p_ops jsonb
)
returns table(
  applied boolean,
  duplicate boolean,
  conflicts jsonb,
  tasks jsonb,
  task_revisions jsonb,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_op jsonb;
  v_id text;
  v_kind text;
  v_payload jsonb;
  v_base_revision bigint;
  v_current_revision bigint;
  v_current_deleted timestamptz;
  v_conflicts jsonb := '[]'::jsonb;
  v_now timestamptz := now();
  v_tasks jsonb;
  v_revisions jsonb;
begin
  if p_user_id is null or coalesce(trim(p_mutation_id), '') = '' then
    raise exception 'invalid_task_sync_request';
  end if;

  -- Serializa mutations da mesma conta. Isso elimina corrida Mac/celular.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  if exists (
    select 1 from public.constancce_task_mutations
    where user_id = p_user_id and mutation_id = p_mutation_id
  ) then
    select coalesce(jsonb_agg(payload order by updated_at, task_id) filter (where deleted_at is null), '[]'::jsonb),
           coalesce(jsonb_object_agg(task_id, revision), '{}'::jsonb),
           coalesce(max(updated_at), now())
      into v_tasks, v_revisions, v_now
    from public.constancce_tasks where user_id = p_user_id;
    return query select true, true, '[]'::jsonb, v_tasks, v_revisions, v_now;
    return;
  end if;

  for v_op in select value from jsonb_array_elements(coalesce(p_ops, '[]'::jsonb)) loop
    v_id := trim(coalesce(v_op->>'id',''));
    v_kind := lower(trim(coalesce(v_op->>'op','')));
    v_base_revision := greatest(0, coalesce((v_op->>'baseRevision')::bigint, 0));
    if v_id = '' or v_kind not in ('upsert','delete') then
      continue;
    end if;

    select revision, deleted_at
      into v_current_revision, v_current_deleted
    from public.constancce_tasks
    where user_id = p_user_id and task_id = v_id
    for update;

    if v_kind = 'delete' then
      -- Exclusão explícita é definitiva e vence edição concorrente antiga.
      if found then
        update public.constancce_tasks
           set revision = revision + 1,
               deleted_at = v_now,
               updated_at = v_now
         where user_id = p_user_id and task_id = v_id;
      else
        insert into public.constancce_tasks(user_id, task_id, payload, revision, deleted_at, updated_at)
        values (p_user_id, v_id, jsonb_build_object('id', v_id), 1, v_now, v_now);
      end if;
      continue;
    end if;

    v_payload := coalesce(v_op->'payload', '{}'::jsonb);
    if coalesce(v_payload->>'id','') <> v_id then
      v_payload := jsonb_set(v_payload, '{id}', to_jsonb(v_id), true);
    end if;

    if found then
      -- Não ressuscita tombstone por edição de um dispositivo desatualizado.
      if v_current_deleted is not null then
        v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
          'id', v_id, 'reason', 'deleted_remotely', 'revision', v_current_revision
        ));
        continue;
      end if;
      if v_base_revision > 0 and v_current_revision <> v_base_revision then
        v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
          'id', v_id, 'reason', 'revision_conflict', 'revision', v_current_revision
        ));
        continue;
      end if;
      update public.constancce_tasks
         set payload = v_payload,
             revision = revision + 1,
             deleted_at = null,
             updated_at = v_now
       where user_id = p_user_id and task_id = v_id;
    else
      if v_base_revision > 0 then
        v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
          'id', v_id, 'reason', 'missing_remote', 'revision', 0
        ));
        continue;
      end if;
      insert into public.constancce_tasks(user_id, task_id, payload, revision, deleted_at, updated_at)
      values (p_user_id, v_id, v_payload, 1, null, v_now);
    end if;
  end loop;

  insert into public.constancce_task_mutations(user_id, mutation_id, client_id, operations, created_at)
  values (p_user_id, p_mutation_id, nullif(p_client_id,''), coalesce(p_ops,'[]'::jsonb), v_now)
  on conflict (user_id, mutation_id) do nothing;

  select coalesce(jsonb_agg(payload order by updated_at, task_id) filter (where deleted_at is null), '[]'::jsonb),
         coalesce(jsonb_object_agg(task_id, revision), '{}'::jsonb),
         coalesce(max(updated_at), v_now)
    into v_tasks, v_revisions, v_now
  from public.constancce_tasks where user_id = p_user_id;

  return query select true, false, v_conflicts, v_tasks, v_revisions, v_now;
end;
$$;

revoke all on function public.constancce_apply_task_ops(uuid,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.constancce_apply_task_ops(uuid,text,text,jsonb)
  to service_role;

create or replace function public.constancce_cleanup_task_mutations()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare v_count bigint;
begin
  delete from public.constancce_task_mutations where created_at < now() - interval '30 days';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.constancce_cleanup_task_mutations() from public, anon, authenticated;
grant execute on function public.constancce_cleanup_task_mutations() to service_role;

commit;

-- OBS.: bloco complementar abaixo é idempotente e pode ser executado após o COMMIT
-- acima. Habilita apenas leitura Realtime da própria conta; escrita direta
-- continua bloqueada e passa exclusivamente pela Edge Function domain-sync.

grant select on table public.constancce_tasks to authenticated;

drop policy if exists "constancce_tasks_select_own" on public.constancce_tasks;
create policy "constancce_tasks_select_own"
on public.constancce_tasks
for select
to authenticated
using (auth.uid() = user_id);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'constancce_tasks'
  ) then
    alter publication supabase_realtime add table public.constancce_tasks;
  end if;
end $$;
