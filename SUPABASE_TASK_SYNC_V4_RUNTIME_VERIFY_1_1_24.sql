-- Teste de runtime sem persistir alteração.
-- Deve retornar 1 linha com applied=true e uma lista de tarefas.
begin;

select *
from public.constancce_apply_task_ops(
  (select t.user_id from public.constancce_tasks t limit 1),
  'runtime-selftest-' || gen_random_uuid()::text,
  'sql-runtime-selftest',
  '[]'::jsonb
);

rollback;
