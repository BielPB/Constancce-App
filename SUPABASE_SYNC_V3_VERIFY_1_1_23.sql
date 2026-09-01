-- CONSTANCCE 1.1.23 — verificação do Sync V3. NÃO altera dados.
select to_regclass('public.constancce_sync_state') as sync_state_table,
       to_regclass('public.constancce_sync_mutations') as sync_mutations_table;

select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('constancce_apply_sync_patch','constancce_cleanup_sync_mutations');

select count(*) as contas_com_estado_v3,
       coalesce(max(revision),0) as maior_revision,
       max(updated_at) as ultima_sincronizacao
from public.constancce_sync_state;

select user_id,
       revision,
       updated_at,
       jsonb_array_length(coalesce(data->'tasks','[]'::jsonb)) as tarefas,
       jsonb_array_length(coalesce(data->'habits','[]'::jsonb)) as habitos,
       jsonb_array_length(coalesce(data->'workoutSessions','[]'::jsonb)) as sessoes_treino,
       jsonb_array_length(coalesce(data->'transactions','[]'::jsonb)) as transacoes,
       field_revisions
from public.constancce_sync_state
order by updated_at desc
limit 20;

select user_id, mutation_id, client_id, changed_keys, applied_revision, created_at
from public.constancce_sync_mutations
order by created_at desc
limit 30;
