-- ============================================================================
-- CONSTANCCE 1.1.25 — TASK SYNC V5 / RPC DIRETA E TRANSACIONAL
-- Remove Tarefas da dependência da Edge Function domain-sync.
-- Mantém constancce_tasks como fonte canônica e usa auth.uid() no banco.
-- Pode ser executado mais de uma vez com segurança.
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
revoke all on table public.constancce_task_mutations from public, anon, authenticated;

-- Função interna endurecida: valida horário e limite FREE no próprio banco.
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
  v_is_pro boolean := false;
  v_current_active integer := 0;
  v_projected_active integer := 0;
  v_existing_active boolean;
begin
  if p_user_id is null or coalesce(trim(p_mutation_id), '') = '' then
    raise exception 'invalid_task_sync_request';
  end if;
  if length(p_mutation_id) > 220 or length(coalesce(p_client_id,'')) > 220 then
    raise exception 'invalid_task_sync_request';
  end if;
  if jsonb_typeof(coalesce(p_ops, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_ops, '[]'::jsonb)) > 200 then
    raise exception 'task_sync_payload_too_large';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  if exists (
    select 1
    from public.constancce_task_mutations m
    where m.user_id = p_user_id
      and m.mutation_id = p_mutation_id
  ) then
    select
      coalesce(jsonb_agg(t.payload order by t.updated_at, t.task_id) filter (where t.deleted_at is null), '[]'::jsonb),
      coalesce(jsonb_object_agg(t.task_id, t.revision), '{}'::jsonb),
      coalesce(max(t.updated_at), now())
    into v_tasks, v_revisions, v_now
    from public.constancce_tasks t
    where t.user_id = p_user_id;

    return query select true, true, '[]'::jsonb, v_tasks, v_revisions, v_now;
    return;
  end if;

  select coalesce(
    a.plan = 'lifetime'
    or (
      a.plan = 'trial'
      and a.payment_status = 'complimentary_trial'
      and a.trial_ends_at is not null
      and a.trial_ends_at > now()
    ), false
  )
  into v_is_pro
  from public.constancce_access a
  where a.user_id = p_user_id;
  v_is_pro := coalesce(v_is_pro, false);

  select count(*)::integer
  into v_current_active
  from public.constancce_tasks t
  where t.user_id = p_user_id
    and t.deleted_at is null
    and (
      coalesce(t.payload->>'repeat', 'none') <> 'none'
      or coalesce(t.payload->>'status', '') <> 'concluida'
    );
  v_projected_active := v_current_active;

  -- Pré-valida o lote inteiro antes de alterar qualquer row.
  for v_op in select value from jsonb_array_elements(coalesce(p_ops, '[]'::jsonb)) loop
    v_id := trim(coalesce(v_op->>'id', ''));
    v_kind := lower(trim(coalesce(v_op->>'op', '')));
    if v_id = '' or v_kind not in ('upsert', 'delete') then
      continue;
    end if;

    select exists(
      select 1
      from public.constancce_tasks t
      where t.user_id = p_user_id
        and t.task_id = v_id
        and t.deleted_at is null
        and (
          coalesce(t.payload->>'repeat', 'none') <> 'none'
          or coalesce(t.payload->>'status', '') <> 'concluida'
        )
    ) into v_existing_active;

    if v_kind = 'delete' then
      if v_existing_active then v_projected_active := greatest(0, v_projected_active - 1); end if;
      continue;
    end if;

    v_payload := coalesce(v_op->'payload', '{}'::jsonb);
    if length(v_payload::text) > 65536 then
      raise exception 'task_payload_too_large';
    end if;
    if coalesce(v_payload->>'taskTime', '') !~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'task_time_required';
    end if;

    if not v_existing_active and (
      coalesce(v_payload->>'repeat', 'none') <> 'none'
      or coalesce(v_payload->>'status', '') <> 'concluida'
    ) then
      v_projected_active := v_projected_active + 1;
    elsif v_existing_active and not (
      coalesce(v_payload->>'repeat', 'none') <> 'none'
      or coalesce(v_payload->>'status', '') <> 'concluida'
    ) then
      v_projected_active := greatest(0, v_projected_active - 1);
    end if;
  end loop;

  if not v_is_pro and v_projected_active > greatest(5, v_current_active) then
    raise exception 'free_limit_tasks';
  end if;

  for v_op in select value from jsonb_array_elements(coalesce(p_ops, '[]'::jsonb)) loop
    v_id := trim(coalesce(v_op->>'id', ''));
    v_kind := lower(trim(coalesce(v_op->>'op', '')));
    begin
      v_base_revision := greatest(0, coalesce((v_op->>'baseRevision')::bigint, 0));
    exception when others then
      v_base_revision := 0;
    end;
    if v_id = '' or v_kind not in ('upsert', 'delete') then continue; end if;

    v_current_revision := null;
    v_current_deleted := null;
    select t.revision, t.deleted_at
    into v_current_revision, v_current_deleted
    from public.constancce_tasks t
    where t.user_id = p_user_id and t.task_id = v_id
    for update;

    if v_kind = 'delete' then
      if found then
        update public.constancce_tasks t
        set revision = t.revision + 1,
            deleted_at = v_now,
            updated_at = v_now
        where t.user_id = p_user_id and t.task_id = v_id;
      else
        insert into public.constancce_tasks(user_id, task_id, payload, revision, deleted_at, updated_at)
        values (p_user_id, v_id, jsonb_build_object('id', v_id), 1, v_now, v_now);
      end if;
      continue;
    end if;

    v_payload := coalesce(v_op->'payload', '{}'::jsonb);
    if coalesce(v_payload->>'id', '') <> v_id then
      v_payload := jsonb_set(v_payload, '{id}', to_jsonb(v_id), true);
    end if;

    if found then
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
      update public.constancce_tasks t
      set payload = v_payload,
          revision = t.revision + 1,
          deleted_at = null,
          updated_at = v_now
      where t.user_id = p_user_id and t.task_id = v_id;
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
  values (p_user_id, p_mutation_id, nullif(p_client_id, ''), coalesce(p_ops, '[]'::jsonb), v_now)
  on conflict (user_id, mutation_id) do nothing;

  select
    coalesce(jsonb_agg(t.payload order by t.updated_at, t.task_id) filter (where t.deleted_at is null), '[]'::jsonb),
    coalesce(jsonb_object_agg(t.task_id, t.revision), '{}'::jsonb),
    coalesce(max(t.updated_at), v_now)
  into v_tasks, v_revisions, v_now
  from public.constancce_tasks t
  where t.user_id = p_user_id;

  return query select true, false, v_conflicts, v_tasks, v_revisions, v_now;
end;
$$;

revoke all on function public.constancce_apply_task_ops(uuid,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.constancce_apply_task_ops(uuid,text,text,jsonb)
  to service_role;

-- Wrapper público autenticado. O usuário nunca escolhe p_user_id: sempre auth.uid().
create or replace function public.constancce_apply_my_task_ops(
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
  v_user_id uuid := auth.uid();
  v_confirmed timestamptz;
begin
  if v_user_id is null then raise exception 'unauthorized'; end if;
  select u.email_confirmed_at into v_confirmed from auth.users u where u.id = v_user_id;
  if v_confirmed is null then raise exception 'email_not_confirmed'; end if;

  return query
  select *
  from public.constancce_apply_task_ops(v_user_id, p_mutation_id, p_client_id, p_ops);
end;
$$;

revoke all on function public.constancce_apply_my_task_ops(text,text,jsonb) from public, anon;
grant execute on function public.constancce_apply_my_task_ops(text,text,jsonb) to authenticated;

-- Leitura direta continua protegida por RLS da própria conta.
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
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'constancce_tasks'
  ) then
    alter publication supabase_realtime add table public.constancce_tasks;
  end if;
end $$;

commit;
