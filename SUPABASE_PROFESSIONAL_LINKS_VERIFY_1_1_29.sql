-- CONSTANCCE 1.1.29 — VERIFICAÇÃO: vínculo profissional e prescrições
-- Somente SELECTs. Rode depois de SUPABASE_PROFESSIONAL_LINKS_1_1_29.sql.

-- 1) RLS ativo nas duas tabelas novas
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname='public'
  and tablename in ('constancce_professional_links','constancce_prescriptions')
order by tablename;

-- 2) Nenhuma tabela nova deve ter grant direto para anon/authenticated (só via RPC)
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema='public'
  and table_name in ('constancce_professional_links','constancce_prescriptions')
  and grantee in ('anon','authenticated')
order by table_name, grantee, privilege_type;
-- esperado: nenhuma linha

-- 3) Grants das novas funções: esperado só 'authenticated' (execute)
select routine_name, grantee, privilege_type
from information_schema.role_routine_grants
where routine_schema='public'
  and routine_name in (
    'invite_constancce_client','get_constancce_professional_links',
    'respond_constancce_professional_link','remove_constancce_professional_link',
    'send_constancce_prescription','get_constancce_prescriptions',
    'respond_constancce_prescription'
  )
order by routine_name, grantee;

-- 4) Constraints de integridade nas tabelas novas
select conname, conrelid::regclass as tabela, pg_get_constraintdef(oid) as definicao
from pg_constraint
where conrelid in ('public.constancce_professional_links'::regclass, 'public.constancce_prescriptions'::regclass)
order by tabela, conname;

-- 5) Contagem geral (deve ser 0/0 logo após rodar o script pela primeira vez)
select
  (select count(*) from public.constancce_professional_links) as vinculos,
  (select count(*) from public.constancce_prescriptions) as prescricoes;

-- 6) Teste manual (opcional, autenticado como um usuário PRO de teste no SQL Editor
-- não é possível simular auth.uid() diretamente — teste pelo app após o deploy):
-- select public.invite_constancce_client('aluno-de-teste@exemplo.com','personal');
