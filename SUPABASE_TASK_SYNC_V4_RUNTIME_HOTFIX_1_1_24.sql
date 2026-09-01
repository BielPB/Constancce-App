-- ============================================================================
-- CONSTANCCE 1.1.24 — TASK SYNC V4 RUNTIME HOTFIX
-- Corrige ambiguidade PL/pgSQL em `updated_at` dentro de
-- public.constancce_apply_task_ops().
-- Pode ser executado mais de uma vez com segurança.
-- Não apaga nem altera tarefas existentes.
-- ============================================================================

begin;

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

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  if exists (
    select 1
    from public.constancce_task_mutations m
    where m.user_id = p_user_id
      and m.mutation_id = p_mutation_id
  ) then
    select
      coalesce(
        jsonb_agg(t.payload order by t.updated_at, t.task_id)
          filter (where t.deleted_at is null),
        '[]'::jsonb
      ),
      coalesce(jsonb_object_agg(t.task_id, t.revision), '{}'::jsonb),
      coalesce(max(t.updated_at), now())
    into v_tasks, v_revisions, v_now
    from public.constancce_tasks t
    where t.user_id = p_user_id;

    return query
      select true, true, '[]'::jsonb, v_tasks, v_revisions, v_now;
    return;
  end if;

  for v_op in
    select value
    from jsonb_array_elements(coalesce(p_ops, '[]'::jsonb))
  loop
    v_id := trim(coalesce(v_op->>'id', ''));
    v_kind := lower(trim(coalesce(v_op->>'op', '')));

    begin
      v_base_revision := greatest(0, coalesce((v_op->>'baseRevision')::bigint, 0));
    exception when others then
      v_base_revision := 0;
    end;

    if v_id = '' or v_kind not in ('upsert', 'delete') then
      continue;
    end if;

    v_current_revision := null;
    v_current_deleted := null;

    select t.revision, t.deleted_at
    into v_current_revision, v_current_deleted
    from public.constancce_tasks t
    where t.user_id = p_user_id
      and t.task_id = v_id
    for update;

    if v_kind = 'delete' then
      if found then
        update public.constancce_tasks t
        set revision = t.revision + 1,
            deleted_at = v_now,
            updated_at = v_now
        where t.user_id = p_user_id
          and t.task_id = v_id;
      else
        insert into public.constancce_tasks(
          user_id, task_id, payload, revision, deleted_at, updated_at
        )
        values (
          p_user_id,
          v_id,
          jsonb_build_object('id', v_id),
          1,
          v_now,
          v_now
        );
      end if;
      continue;
    end if;

    v_payload := coalesce(v_op->'payload', '{}'::jsonb);
    if coalesce(v_payload->>'id', '') <> v_id then
      v_payload := jsonb_set(v_payload, '{id}', to_jsonb(v_id), true);
    end if;

    if found then
      if v_current_deleted is not null then
        v_conflicts := v_conflicts || jsonb_build_array(
          jsonb_build_object(
            'id', v_id,
            'reason', 'deleted_remotely',
            'revision', v_current_revision
          )
        );
        continue;
      end if;

      if v_base_revision > 0 and v_current_revision <> v_base_revision then
        v_conflicts := v_conflicts || jsonb_build_array(
          jsonb_build_object(
            'id', v_id,
            'reason', 'revision_conflict',
            'revision', v_current_revision
          )
        );
        continue;
      end if;

      update public.constancce_tasks t
      set payload = v_payload,
          revision = t.revision + 1,
          deleted_at = null,
          updated_at = v_now
      where t.user_id = p_user_id
        and t.task_id = v_id;
    else
      if v_base_revision > 0 then
        v_conflicts := v_conflicts || jsonb_build_array(
          jsonb_build_object(
            'id', v_id,
            'reason', 'missing_remote',
            'revision', 0
          )
        );
        continue;
      end if;

      insert into public.constancce_tasks(
        user_id, task_id, payload, revision, deleted_at, updated_at
      )
      values (
        p_user_id, v_id, v_payload, 1, null, v_now
      );
    end if;
  end loop;

  insert into public.constancce_task_mutations(
    user_id, mutation_id, client_id, operations, created_at
  )
  values (
    p_user_id,
    p_mutation_id,
    nullif(p_client_id, ''),
    coalesce(p_ops, '[]'::jsonb),
    v_now
  )
  on conflict (user_id, mutation_id) do nothing;

  select
    coalesce(
      jsonb_agg(t.payload order by t.updated_at, t.task_id)
        filter (where t.deleted_at is null),
      '[]'::jsonb
    ),
    coalesce(jsonb_object_agg(t.task_id, t.revision), '{}'::jsonb),
    coalesce(max(t.updated_at), v_now)
  into v_tasks, v_revisions, v_now
  from public.constancce_tasks t
  where t.user_id = p_user_id;

  return query
    select true, false, v_conflicts, v_tasks, v_revisions, v_now;
end;
$$;

revoke all on function public.constancce_apply_task_ops(uuid,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.constancce_apply_task_ops(uuid,text,text,jsonb)
  to service_role;

commit;
