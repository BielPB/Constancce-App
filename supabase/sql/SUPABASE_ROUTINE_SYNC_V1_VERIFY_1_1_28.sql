-- CONSTANCCE 1.1.28 — verificação Habits + Workouts Atomic Sync
select
  user_id,
  collection,
  count(*) filter (where deleted_at is null) as ativos,
  count(*) filter (where deleted_at is not null) as excluidos,
  max(updated_at) as ultima_atualizacao
from public.constancce_sync_entities
group by user_id, collection
order by user_id, collection;

select
  collection,
  entity_id,
  payload->>'name' as nome,
  payload->>'title' as titulo,
  payload->>'date' as data,
  payload->>'completed' as concluido,
  revision,
  deleted_at,
  updated_at
from public.constancce_sync_entities
order by updated_at desc
limit 100;

select
  has_function_privilege('authenticated', 'public.constancce_apply_my_entity_op(text,text,text,jsonb)', 'EXECUTE') as authenticated_pode_executar,
  has_table_privilege('authenticated', 'public.constancce_sync_entities', 'SELECT') as authenticated_pode_ler,
  has_table_privilege('authenticated', 'public.constancce_sync_entities', 'INSERT') as authenticated_pode_inserir_direto,
  has_table_privilege('authenticated', 'public.constancce_sync_entities', 'UPDATE') as authenticated_pode_atualizar_direto,
  has_table_privilege('authenticated', 'public.constancce_sync_entities', 'DELETE') as authenticated_pode_excluir_direto;
