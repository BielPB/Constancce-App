-- ============================================================================
-- CONSTANCCE 1.1.26 — TASK SYNC V6
-- Sincronização de Tarefas por mutação individual, idempotente e transacional.
-- Não depende de arrays completos nem da Edge Function domain-sync.
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

revoke all on table public.constancce_tasks from anon;
revoke insert, update, delete on table public.constancce_tasks from authenticated;
grant select on table public.constancce_tasks to authenticated;
revoke all on table public.constancce_task_mutations from public, anon, authenticated;

drop policy if exists "constancce_tasks_select_own" on public.constancce_tasks;
create policy "constancce_tasks_select_own"
on public.constancce_tasks
for select
to authenticated
using (auth.uid() = user_id);

-- Uma única operação por chamada. Isso evita que uma tarefa legada sem horário,
-- não relacionada à ação atual, derrube o lote inteiro.
create or replace function public.constancce_apply_my_task_op(
  p_mutation_id text,
  p_client_id text,
  p_op jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_confirmed timestamptz;
  v_id text;
  v_kind text;
  v_payload jsonb;
  v_base_revision bigint := 0;
  v_current_revision bigint;
  v_current_deleted timestamptz;
  v_now timestamptz := now();
  v_is_pro boolean := false;
  v_active_count integer := 0;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'unauthorized';
  end if;

  select u.email_confirmed_at
  into v_confirmed
  from auth.users u
  where u.id = v_user_id;

  if v_confirmed is null then
    raise exception 'email_not_confirmed';
  end if;

  if coalesce(trim(p_mutation_id), '') = ''
     or length(p_mutation_id) > 220
     or length(coalesce(p_client_id, '')) > 220
     or jsonb_typeof(coalesce(p_op, '{}'::jsonb)) <> 'object' then
    raise exception 'invalid_task_sync_request';
  end if;

  v_id := trim(coalesce(p_op->>'id', ''));
  v_kind := lower(trim(coalesce(p_op->>'op', '')));
  if v_id = '' or v_kind not in ('upsert', 'delete') then
    raise exception 'invalid_task_sync_operation';
  end if;

  begin
    v_base_revision := greatest(0, coalesce((p_op->>'baseRevision')::bigint, 0));
  exception when others then
    v_base_revision := 0;
  end;

  -- Idempotência: um retry de rede da mesma mutação nunca aplica duas vezes.
  if exists (
    select 1
    from public.constancce_task_mutations m
    where m.user_id = v_user_id
      and m.mutation_id = p_mutation_id
  ) then
    select jsonb_build_object(
      'applied', true,
      'duplicate', true,
      'conflict', false,
      'task_id', t.task_id,
      'revision', t.revision,
      'deleted_at', t.deleted_at,
      'updated_at', t.updated_at,
      'task', case when t.deleted_at is null then t.payload else null end
    )
    into v_result
    from public.constancce_tasks t
    where t.user_id = v_user_id and t.task_id = v_id;

    return coalesce(v_result, jsonb_build_object(
      'applied', true, 'duplicate', true, 'conflict', false,
      'task_id', v_id, 'revision', 0, 'task', null
    ));
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || v_id, 0));

  v_current_revision := null;
  v_current_deleted := null;
  select t.revision, t.deleted_at
  into v_current_revision, v_current_deleted
  from public.constancce_tasks t
  where t.user_id = v_user_id and t.task_id = v_id
  for update;

  if v_kind = 'delete' then
    if found then
      -- Se o cliente conhece uma revisão e ela mudou, devolve conflito em vez de
      -- apagar silenciosamente uma edição remota mais nova.
      if v_base_revision > 0 and v_current_revision <> v_base_revision then
        return jsonb_build_object(
          'applied', false,
          'duplicate', false,
          'conflict', true,
          'reason', 'revision_conflict',
          'task_id', v_id,
          'revision', v_current_revision,
          'deleted_at', v_current_deleted
        );
      end if;

      update public.constancce_tasks t
      set revision = t.revision + 1,
          deleted_at = coalesce(t.deleted_at, v_now),
          updated_at = v_now
      where t.user_id = v_user_id and t.task_id = v_id
      returning t.revision, t.deleted_at, t.updated_at
      into v_current_revision, v_current_deleted, v_now;
    else
      insert into public.constancce_tasks(user_id, task_id, payload, revision, deleted_at, updated_at)
      values (v_user_id, v_id, jsonb_build_object('id', v_id), 1, v_now, v_now)
      returning revision, deleted_at, updated_at
      into v_current_revision, v_current_deleted, v_now;
    end if;

    insert into public.constancce_task_mutations(user_id, mutation_id, client_id, operations, created_at)
    values (v_user_id, p_mutation_id, nullif(p_client_id, ''), jsonb_build_array(p_op), v_now)
    on conflict (user_id, mutation_id) do nothing;

    return jsonb_build_object(
      'applied', true,
      'duplicate', false,
      'conflict', false,
      'task_id', v_id,
      'revision', v_current_revision,
      'deleted_at', v_current_deleted,
      'updated_at', v_now,
      'task', null
    );
  end if;

  v_payload := coalesce(p_op->'payload', '{}'::jsonb);
  if length(v_payload::text) > 65536 then
    raise exception 'task_payload_too_large';
  end if;
  if coalesce(v_payload->>'id', '') <> v_id then
    v_payload := jsonb_set(v_payload, '{id}', to_jsonb(v_id), true);
  end if;

  if found then
    if v_current_deleted is not null then
      return jsonb_build_object(
        'applied', false,
        'duplicate', false,
        'conflict', true,
        'reason', 'deleted_remotely',
        'task_id', v_id,
        'revision', v_current_revision,
        'deleted_at', v_current_deleted
      );
    end if;

    if v_base_revision > 0 and v_current_revision <> v_base_revision then
      return jsonb_build_object(
        'applied', false,
        'duplicate', false,
        'conflict', true,
        'reason', 'revision_conflict',
        'task_id', v_id,
        'revision', v_current_revision,
        'deleted_at', null
      );
    end if;

    -- Tarefas antigas sem horário podem ser concluídas/movidas. A obrigatoriedade
    -- de horário vale para novos registros; ao editar pelo formulário o frontend
    -- continua exigindo horário.
    update public.constancce_tasks t
    set payload = v_payload,
        revision = t.revision + 1,
        deleted_at = null,
        updated_at = v_now
    where t.user_id = v_user_id and t.task_id = v_id
    returning t.revision, t.updated_at
    into v_current_revision, v_now;
  else
    -- Somente tarefas novas exigem horário no banco.
    if coalesce(v_payload->>'taskTime', '') !~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'task_time_required';
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
    where a.user_id = v_user_id;
    v_is_pro := coalesce(v_is_pro, false);

    if not v_is_pro then
      select count(*)::integer
      into v_active_count
      from public.constancce_tasks t
      where t.user_id = v_user_id
        and t.deleted_at is null
        and (
          coalesce(t.payload->>'repeat', 'none') <> 'none'
          or coalesce(t.payload->>'status', '') <> 'concluida'
        );
      if v_active_count >= 5 then
        raise exception 'free_limit_tasks';
      end if;
    end if;

    insert into public.constancce_tasks(user_id, task_id, payload, revision, deleted_at, updated_at)
    values (v_user_id, v_id, v_payload, 1, null, v_now)
    returning revision, updated_at
    into v_current_revision, v_now;
  end if;

  insert into public.constancce_task_mutations(user_id, mutation_id, client_id, operations, created_at)
  values (v_user_id, p_mutation_id, nullif(p_client_id, ''), jsonb_build_array(p_op), v_now)
  on conflict (user_id, mutation_id) do nothing;

  return jsonb_build_object(
    'applied', true,
    'duplicate', false,
    'conflict', false,
    'task_id', v_id,
    'revision', v_current_revision,
    'deleted_at', null,
    'updated_at', v_now,
    'task', v_payload
  );
end;
$$;

revoke all on function public.constancce_apply_my_task_op(text,text,jsonb) from public, anon;
grant execute on function public.constancce_apply_my_task_op(text,text,jsonb) to authenticated;

-- Realtime para propagação imediata. Polling REST no app continua como fallback.
alter table public.constancce_tasks replica identity full;
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

-- Garante que o PostgREST veja a nova RPC imediatamente.
notify pgrst, 'reload schema';

commit;
