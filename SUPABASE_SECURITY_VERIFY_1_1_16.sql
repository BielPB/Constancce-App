-- CONSTANCCE 1.1.16 — VERIFICAÇÃO DE SEGURANÇA
-- Somente SELECTs. Rode depois de SUPABASE_SECURITY_HARDENING_1_1_16.sql.

-- 1) RLS nas tabelas críticas
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname='public'
  and tablename in (
    'device_sync','constancce_domain_sync','constancce_access',
    'constancce_events','constancce_activity_events',
    'push_subscriptions','push_notification_log','constancce_rate_limits',
    'constancce_profiles','constancce_friendships',
    'constancce_checkout_sessions','constancce_payment_events'
  )
order by tablename;

-- 2) Grants de anon/authenticated. Revise com atenção qualquer escrita inesperada.
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema='public'
  and grantee in ('anon','authenticated')
order by table_name, grantee, privilege_type;

-- 3) Policies ativas
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname='public'
order by tablename, policyname;

-- 4) Grant da função administrativa: esperado somente service_role entre roles da API.
select routine_schema, routine_name, grantee, privilege_type
from information_schema.role_routine_grants
where routine_schema='public'
  and routine_name in ('grant_constancce_pro','consume_constancce_rate_limit','constancce_email_verified')
order by routine_name, grantee;

-- 5) Novas contas/planos: visualize distribuição sem expor e-mail.
select plan, payment_status, count(*) as usuarios
from public.constancce_access
group by plan, payment_status
order by plan, payment_status;

-- 6) Trials manuais atuais
select user_id, plan, payment_status, trial_ends_at
from public.constancce_access
where plan='trial'
order by trial_ends_at;

-- 7) Checkout/payment ledger
select status, count(*) as total
from public.constancce_checkout_sessions
group by status
order by status;

select status, count(*) as total
from public.constancce_payment_events
group by status
order by status;
