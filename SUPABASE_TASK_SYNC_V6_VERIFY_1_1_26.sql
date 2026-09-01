select
  count(*) filter (where deleted_at is null) as tarefas_ativas,
  count(*) filter (where deleted_at is not null) as tombstones,
  max(updated_at) as ultima_alteracao
from public.constancce_tasks;

select
  routine_name,
  security_type
from information_schema.routines
where routine_schema = 'public'
  and routine_name = 'constancce_apply_my_task_op';

select
  has_function_privilege('authenticated', 'public.constancce_apply_my_task_op(text,text,jsonb)', 'EXECUTE') as authenticated_pode_executar,
  has_table_privilege('authenticated', 'public.constancce_tasks', 'SELECT') as authenticated_pode_ler,
  has_table_privilege('authenticated', 'public.constancce_tasks', 'INSERT') as authenticated_pode_inserir_direto;
