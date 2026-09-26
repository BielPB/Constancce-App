-- Constancce 1.1.30: limite Free de treinos ignora os treinos montados.
--
-- "Montar treino" (PRO) cria treinos ocultos (payload.generated = true), que
-- existem só para o histórico. O limite Free de 2 treinos contava esses
-- treinos: quem montava treinos no PRO temporário e voltava ao Free ficava
-- sem a vaga que o app mostrava como livre ("1/2") e recebia
-- free_limit_workouts ao criar um treino próprio.
--
-- Mudanças em constancce_apply_my_entity_op (resto idêntico à 1.1.28):
--   1. O limite de workout_template conta só treinos próprios (não montados).
--   2. Free não cria treino montado (o recurso é PRO).
--   3. Transformar um treino montado em treino próprio (upsert que tira o
--      generated) também passa pelo limite, para não virar brecha.
--   4. A existência da entidade fica em v_exists (FOUND é sobrescrito pela
--      consulta do plano, que agora roda antes do upsert).
--
-- Idempotente: pode rodar mais de uma vez. Rodar no SQL Editor do Supabase.

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
  v_old_payload jsonb;
  v_exists boolean := false;
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
  v_old_payload := null;
  select e.revision, e.deleted_at, e.payload
  into v_current_revision, v_current_deleted, v_old_payload
  from public.constancce_sync_entities e
  where e.user_id = v_user_id
    and e.collection = v_collection
    and e.entity_id = v_id
  for update;
  -- Guardado aqui: FOUND muda a cada SELECT INTO (a consulta do plano abaixo
  -- sobrescreveria o resultado desta busca).
  v_exists := found;

  if v_kind = 'delete' then
    if v_exists then
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

  -- Plano (usado pelos limites Free abaixo).
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

  if v_exists then
    -- habit_completion e habit_checklist usam chave composta determinística
    -- (habitId:date / habitId:itemId:date) que é legitimamente reaproveitada
    -- toda vez que o usuário marca/desmarca a mesma caixinha no mesmo dia —
    -- não é uma edição sobre algo apagado por outro dispositivo. Tratar isso
    -- como conflito "deleted_remotely" fazia o cliente descartar a marcação
    -- silenciosamente sempre que o dia já tinha sido desmarcado antes, dando
    -- a impressão de que o hábito "desmarca sozinho" ao marcar de novo.
    if v_current_deleted is not null and v_collection not in ('habit_completion', 'habit_checklist') then
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

    -- 1.1.30: treino montado virando treino próprio conta no limite Free.
    if not v_is_pro
       and v_collection = 'workout_template'
       and (v_old_payload->>'generated') is not distinct from 'true'
       and (v_payload->>'generated') is distinct from 'true' then
      select count(*)::integer
      into v_active_count
      from public.constancce_sync_entities e
      where e.user_id = v_user_id
        and e.collection = 'workout_template'
        and e.deleted_at is null
        and e.entity_id <> v_id
        and (e.payload->>'generated') is distinct from 'true';
      if v_active_count >= 2 then
        raise exception 'free_limit_workouts';
      end if;
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
      -- 1.1.30: "Montar treino" é PRO; Free não cria treino montado.
      if (v_payload->>'generated') is not distinct from 'true' then
        raise exception 'free_limit_workouts';
      end if;
      -- 1.1.30: só treinos próprios contam; os montados ficam de fora.
      select count(*)::integer
      into v_active_count
      from public.constancce_sync_entities e
      where e.user_id = v_user_id
        and e.collection = 'workout_template'
        and e.deleted_at is null
        and (e.payload->>'generated') is distinct from 'true';
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
