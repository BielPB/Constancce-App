-- ============================================================================
-- CONSTANCCE 1.1.28 — HABITS + WORKOUTS ATOMIC SYNC V1
-- Escopo EXCLUSIVO: Hábitos, conclusões/checklist e Treinos/sessões.
-- Não altera o Task Sync V6.
-- Pode ser executado mais de uma vez com segurança.
-- ============================================================================

begin;

create table if not exists public.constancce_sync_entities (
  user_id uuid not null references auth.users(id) on delete cascade,
  collection text not null check (collection in (
    'habit',
    'habit_completion',
    'habit_checklist',
    'workout_template',
    'workout_session'
  )),
  entity_id text not null,
  payload jsonb not null default '{}'::jsonb,
  revision bigint not null default 1 check (revision >= 1),
  deleted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, collection, entity_id)
);

create index if not exists constancce_sync_entities_user_collection_updated_idx
  on public.constancce_sync_entities(user_id, collection, updated_at desc);

create table if not exists public.constancce_entity_mutations (
  user_id uuid not null references auth.users(id) on delete cascade,
  mutation_id text not null,
  collection text not null,
  entity_id text not null,
  client_id text,
  operation jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, mutation_id)
);

alter table public.constancce_sync_entities enable row level security;
alter table public.constancce_entity_mutations enable row level security;

revoke all on table public.constancce_sync_entities from anon;
revoke insert, update, delete on table public.constancce_sync_entities from authenticated;
grant select on table public.constancce_sync_entities to authenticated;
revoke all on table public.constancce_entity_mutations from public, anon, authenticated;

drop policy if exists "constancce_sync_entities_select_own" on public.constancce_sync_entities;
create policy "constancce_sync_entities_select_own"
on public.constancce_sync_entities
for select
to authenticated
using (auth.uid() = user_id);

create or replace function public.constancce_apply_my_entity_op(
  p_collection text,
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
  v_collection text := lower(trim(coalesce(p_collection, '')));
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

  if v_collection not in ('habit','habit_completion','habit_checklist','workout_template','workout_session') then
    raise exception 'invalid_collection';
  end if;

  if coalesce(trim(p_mutation_id), '') = ''
     or length(p_mutation_id) > 220
     or length(coalesce(p_client_id, '')) > 220
     or jsonb_typeof(coalesce(p_op, '{}'::jsonb)) <> 'object' then
    raise exception 'invalid_entity_sync_request';
  end if;

  v_id := trim(coalesce(p_op->>'id', ''));
  v_kind := lower(trim(coalesce(p_op->>'op', '')));
  if v_id = '' or length(v_id) > 260 or v_kind not in ('upsert', 'delete') then
    raise exception 'invalid_entity_sync_operation';
  end if;

  begin
    v_base_revision := greatest(0, coalesce((p_op->>'baseRevision')::bigint, 0));
  exception when others then
    v_base_revision := 0;
  end;

  if exists (
    select 1
    from public.constancce_entity_mutations m
    where m.user_id = v_user_id
      and m.mutation_id = p_mutation_id
  ) then
    select jsonb_build_object(
      'applied', true,
      'duplicate', true,
      'conflict', false,
      'collection', e.collection,
      'entity_id', e.entity_id,
      'revision', e.revision,
      'deleted_at', e.deleted_at,
      'updated_at', e.updated_at,
      'entity', case when e.deleted_at is null then e.payload else null end
    )
    into v_result
    from public.constancce_sync_entities e
    where e.user_id = v_user_id
      and e.collection = v_collection
      and e.entity_id = v_id;

    return coalesce(v_result, jsonb_build_object(
      'applied', true, 'duplicate', true, 'conflict', false,
      'collection', v_collection, 'entity_id', v_id, 'revision', 0, 'entity', null
    ));
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || v_collection || ':' || v_id, 0));

  v_current_revision := null;
  v_current_deleted := null;
  select e.revision, e.deleted_at
  into v_current_revision, v_current_deleted
  from public.constancce_sync_entities e
  where e.user_id = v_user_id
    and e.collection = v_collection
    and e.entity_id = v_id
  for update;

  if v_kind = 'delete' then
    if found then
      if v_base_revision > 0 and v_current_revision <> v_base_revision then
        return jsonb_build_object(
          'applied', false,
          'duplicate', false,
          'conflict', true,
          'reason', 'revision_conflict',
          'collection', v_collection,
          'entity_id', v_id,
          'revision', v_current_revision,
          'deleted_at', v_current_deleted
        );
      end if;

      update public.constancce_sync_entities e
      set revision = e.revision + 1,
          deleted_at = coalesce(e.deleted_at, v_now),
          updated_at = v_now
      where e.user_id = v_user_id
        and e.collection = v_collection
        and e.entity_id = v_id
      returning e.revision, e.deleted_at, e.updated_at
      into v_current_revision, v_current_deleted, v_now;
    else
      insert into public.constancce_sync_entities(user_id, collection, entity_id, payload, revision, deleted_at, updated_at)
      values (v_user_id, v_collection, v_id, jsonb_build_object('id', v_id), 1, v_now, v_now)
      returning revision, deleted_at, updated_at
      into v_current_revision, v_current_deleted, v_now;
    end if;

    insert into public.constancce_entity_mutations(user_id, mutation_id, collection, entity_id, client_id, operation, created_at)
    values (v_user_id, p_mutation_id, v_collection, v_id, nullif(p_client_id, ''), p_op, v_now)
    on conflict (user_id, mutation_id) do nothing;

    return jsonb_build_object(
      'applied', true,
      'duplicate', false,
      'conflict', false,
      'collection', v_collection,
      'entity_id', v_id,
      'revision', v_current_revision,
      'deleted_at', v_current_deleted,
      'updated_at', v_now,
      'entity', null
    );
  end if;

  v_payload := coalesce(p_op->'payload', '{}'::jsonb);
  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'invalid_entity_payload';
  end if;
  if length(v_payload::text) > 262144 then
    raise exception 'entity_payload_too_large';
  end if;

  if found then
    if v_current_deleted is not null then
      return jsonb_build_object(
        'applied', false,
        'duplicate', false,
        'conflict', true,
        'reason', 'deleted_remotely',
        'collection', v_collection,
        'entity_id', v_id,
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
        'collection', v_collection,
        'entity_id', v_id,
        'revision', v_current_revision,
        'deleted_at', null
      );
    end if;

    update public.constancce_sync_entities e
    set payload = v_payload,
        revision = e.revision + 1,
        deleted_at = null,
        updated_at = v_now
    where e.user_id = v_user_id
      and e.collection = v_collection
      and e.entity_id = v_id
    returning e.revision, e.updated_at
    into v_current_revision, v_now;
  else
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

    if not v_is_pro and v_collection = 'habit' and coalesce((v_payload->>'active')::boolean, true) then
      select count(*)::integer
      into v_active_count
      from public.constancce_sync_entities e
      where e.user_id = v_user_id
        and e.collection = 'habit'
        and e.deleted_at is null
        and coalesce((e.payload->>'active')::boolean, true);
      if v_active_count >= 5 then
        raise exception 'free_limit_habits';
      end if;
    end if;

    if not v_is_pro and v_collection = 'workout_template' then
      select count(*)::integer
      into v_active_count
      from public.constancce_sync_entities e
      where e.user_id = v_user_id
        and e.collection = 'workout_template'
        and e.deleted_at is null;
      if v_active_count >= 2 then
        raise exception 'free_limit_workouts';
      end if;
    end if;

    insert into public.constancce_sync_entities(user_id, collection, entity_id, payload, revision, deleted_at, updated_at)
    values (v_user_id, v_collection, v_id, v_payload, 1, null, v_now)
    returning revision, updated_at
    into v_current_revision, v_now;
  end if;

  insert into public.constancce_entity_mutations(user_id, mutation_id, collection, entity_id, client_id, operation, created_at)
  values (v_user_id, p_mutation_id, v_collection, v_id, nullif(p_client_id, ''), p_op, v_now)
  on conflict (user_id, mutation_id) do nothing;

  return jsonb_build_object(
    'applied', true,
    'duplicate', false,
    'conflict', false,
    'collection', v_collection,
    'entity_id', v_id,
    'revision', v_current_revision,
    'deleted_at', null,
    'updated_at', v_now,
    'entity', v_payload
  );
end;
$$;

revoke all on function public.constancce_apply_my_entity_op(text,text,text,jsonb) from public, anon;
grant execute on function public.constancce_apply_my_entity_op(text,text,text,jsonb) to authenticated;

-- Backfill seguro do snapshot canônico existente. Não sobrescreve entidades que
-- já tenham sido gravadas pelo mecanismo atômico.
do $$
begin
  if to_regclass('public.constancce_sync_state') is not null then
    insert into public.constancce_sync_entities(user_id, collection, entity_id, payload, revision, deleted_at, updated_at)
    select s.user_id, 'habit', coalesce(nullif(x.item->>'id',''), md5(x.item::text)),
           x.item || jsonb_build_object('__syncOrder', x.ord - 1), 1, null, s.updated_at
    from public.constancce_sync_state s
    cross join lateral jsonb_array_elements(coalesce(s.data->'habits','[]'::jsonb)) with ordinality as x(item, ord)
    on conflict (user_id, collection, entity_id) do nothing;

    insert into public.constancce_sync_entities(user_id, collection, entity_id, payload, revision, deleted_at, updated_at)
    select s.user_id, 'habit_completion',
           coalesce(nullif(x.item->>'id',''), concat_ws(':', x.item->>'habitId', x.item->>'date')),
           x.item || jsonb_build_object('__syncOrder', x.ord - 1), 1, null, s.updated_at
    from public.constancce_sync_state s
    cross join lateral jsonb_array_elements(coalesce(s.data->'completions','[]'::jsonb)) with ordinality as x(item, ord)
    where coalesce(nullif(x.item->>'id',''), concat_ws(':', x.item->>'habitId', x.item->>'date')) <> ''
    on conflict (user_id, collection, entity_id) do nothing;

    insert into public.constancce_sync_entities(user_id, collection, entity_id, payload, revision, deleted_at, updated_at)
    select s.user_id, 'habit_checklist',
           coalesce(nullif(x.item->>'id',''), concat_ws(':', x.item->>'habitId', x.item->>'itemId', x.item->>'date')),
           x.item || jsonb_build_object('__syncOrder', x.ord - 1), 1, null, s.updated_at
    from public.constancce_sync_state s
    cross join lateral jsonb_array_elements(coalesce(s.data->'habitChecklistLog','[]'::jsonb)) with ordinality as x(item, ord)
    where coalesce(nullif(x.item->>'id',''), concat_ws(':', x.item->>'habitId', x.item->>'itemId', x.item->>'date')) <> ''
    on conflict (user_id, collection, entity_id) do nothing;

    insert into public.constancce_sync_entities(user_id, collection, entity_id, payload, revision, deleted_at, updated_at)
    select s.user_id, 'workout_template', coalesce(nullif(x.item->>'id',''), md5(x.item::text)),
           x.item || jsonb_build_object('__syncOrder', x.ord - 1), 1, null, s.updated_at
    from public.constancce_sync_state s
    cross join lateral jsonb_array_elements(coalesce(s.data->'workoutTemplates','[]'::jsonb)) with ordinality as x(item, ord)
    on conflict (user_id, collection, entity_id) do nothing;

    insert into public.constancce_sync_entities(user_id, collection, entity_id, payload, revision, deleted_at, updated_at)
    select s.user_id, 'workout_session', coalesce(nullif(x.item->>'id',''), md5(x.item::text)),
           x.item || jsonb_build_object('__syncOrder', x.ord - 1), 1, null, s.updated_at
    from public.constancce_sync_state s
    cross join lateral jsonb_array_elements(coalesce(s.data->'workoutSessions','[]'::jsonb)) with ordinality as x(item, ord)
    on conflict (user_id, collection, entity_id) do nothing;
  end if;
end $$;

-- Fallback de backfill por domínio para instalações onde o snapshot canônico não
-- contém algum dos módulos. Apenas preenche entidades ainda inexistentes.
do $$
begin
  if to_regclass('public.constancce_domain_sync') is not null then
    insert into public.constancce_sync_entities(user_id, collection, entity_id, payload, revision, deleted_at, updated_at)
    select d.user_id, 'habit', coalesce(nullif(x.item->>'id',''), md5(x.item::text)),
           x.item || jsonb_build_object('__syncOrder', x.ord - 1), 1, null, d.updated_at
    from public.constancce_domain_sync d
    cross join lateral jsonb_array_elements(coalesce(d.data->'habits','[]'::jsonb)) with ordinality as x(item, ord)
    where d.domain = 'habits'
    on conflict (user_id, collection, entity_id) do nothing;

    insert into public.constancce_sync_entities(user_id, collection, entity_id, payload, revision, deleted_at, updated_at)
    select d.user_id, 'habit_completion',
           coalesce(nullif(x.item->>'id',''), concat_ws(':', x.item->>'habitId', x.item->>'date')),
           x.item || jsonb_build_object('__syncOrder', x.ord - 1), 1, null, d.updated_at
    from public.constancce_domain_sync d
    cross join lateral jsonb_array_elements(coalesce(d.data->'completions','[]'::jsonb)) with ordinality as x(item, ord)
    where d.domain = 'habits'
    on conflict (user_id, collection, entity_id) do nothing;

    insert into public.constancce_sync_entities(user_id, collection, entity_id, payload, revision, deleted_at, updated_at)
    select d.user_id, 'habit_checklist',
           coalesce(nullif(x.item->>'id',''), concat_ws(':', x.item->>'habitId', x.item->>'itemId', x.item->>'date')),
           x.item || jsonb_build_object('__syncOrder', x.ord - 1), 1, null, d.updated_at
    from public.constancce_domain_sync d
    cross join lateral jsonb_array_elements(coalesce(d.data->'habitChecklistLog','[]'::jsonb)) with ordinality as x(item, ord)
    where d.domain = 'habits'
    on conflict (user_id, collection, entity_id) do nothing;

    insert into public.constancce_sync_entities(user_id, collection, entity_id, payload, revision, deleted_at, updated_at)
    select d.user_id, 'workout_template', coalesce(nullif(x.item->>'id',''), md5(x.item::text)),
           x.item || jsonb_build_object('__syncOrder', x.ord - 1), 1, null, d.updated_at
    from public.constancce_domain_sync d
    cross join lateral jsonb_array_elements(coalesce(d.data->'workoutTemplates','[]'::jsonb)) with ordinality as x(item, ord)
    where d.domain = 'workouts'
    on conflict (user_id, collection, entity_id) do nothing;

    insert into public.constancce_sync_entities(user_id, collection, entity_id, payload, revision, deleted_at, updated_at)
    select d.user_id, 'workout_session', coalesce(nullif(x.item->>'id',''), md5(x.item::text)),
           x.item || jsonb_build_object('__syncOrder', x.ord - 1), 1, null, d.updated_at
    from public.constancce_domain_sync d
    cross join lateral jsonb_array_elements(coalesce(d.data->'workoutSessions','[]'::jsonb)) with ordinality as x(item, ord)
    where d.domain = 'workouts'
    on conflict (user_id, collection, entity_id) do nothing;
  end if;
end $$;

alter table public.constancce_sync_entities replica identity full;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'constancce_sync_entities'
  ) then
    alter publication supabase_realtime add table public.constancce_sync_entities;
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
