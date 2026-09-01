-- Diagnóstico somente leitura — 1.1.24
select to_regclass('public.constancce_tasks') as tasks_table,
       to_regclass('public.constancce_task_mutations') as mutations_table;

select user_id,
       count(*) filter (where deleted_at is null) as tarefas_ativas,
       count(*) filter (where deleted_at is not null) as tombstones,
       max(updated_at) as ultima_alteracao
from public.constancce_tasks
group by user_id
order by ultima_alteracao desc;

select user_id, task_id, revision, deleted_at, updated_at,
       payload->>'title' as titulo
from public.constancce_tasks
order by updated_at desc
limit 100;

select user_id, mutation_id, client_id, created_at
from public.constancce_task_mutations
order by created_at desc
limit 100;

select policyname, roles, cmd, qual
from pg_policies
where schemaname='public' and tablename='constancce_tasks';

select * from pg_publication_tables
where pubname='supabase_realtime' and schemaname='public' and tablename='constancce_tasks';
