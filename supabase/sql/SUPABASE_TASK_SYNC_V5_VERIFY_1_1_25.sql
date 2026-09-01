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
  and routine_name in ('constancce_apply_task_ops','constancce_apply_my_task_ops')
order by routine_name;
