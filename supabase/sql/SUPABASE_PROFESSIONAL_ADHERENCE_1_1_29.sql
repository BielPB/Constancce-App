-- ============================================================================
-- CONSTANCCE 1.1.29 — ADERÊNCIA DO ALUNO (PAINEL DO PERSONAL)
-- Execute UMA VEZ no Supabase SQL Editor, depois de
-- SUPABASE_PROFESSIONAL_LINKS_1_1_29.sql e SUPABASE_ROUTINE_SYNC_V1_1_1_28.sql
-- (usa public.constancce_professional_links e public.constancce_sync_entities,
-- já criados por aqueles scripts).
--
-- Expõe só agregados (quantidade de treinos concluídos e data do último) —
-- nunca dados brutos como cargas, notas ou nomes de exercício do aluno. Só o
-- personal do vínculo aceito correspondente pode chamar, e só para o próprio
-- vínculo.
-- ============================================================================

begin;

create or replace function public.get_constancce_client_adherence(p_link_id bigint)
returns table(
  workouts_completed_30d integer,
  last_workout_date date
)
language plpgsql security definer set search_path=public,auth as $$
declare v_me uuid:=auth.uid(); v_link public.constancce_professional_links%rowtype;
begin
  if v_me is null or not public.constancce_email_verified() then raise exception 'unauthorized'; end if;

  select * into v_link from public.constancce_professional_links
  where id=p_link_id and professional_id=v_me and status='accepted' and link_type='personal';
  if not found then raise exception 'link not found'; end if;

  return query
  select
    count(*) filter (
      where (e.payload->>'completed')::boolean is true
        and e.payload->>'date' ~ '^\d{4}-\d{2}-\d{2}$'
        and (e.payload->>'date')::date >= (current_date - interval '30 days')
    )::integer as workouts_completed_30d,
    max((e.payload->>'date')::date) filter (
      where (e.payload->>'completed')::boolean is true
        and e.payload->>'date' ~ '^\d{4}-\d{2}-\d{2}$'
    ) as last_workout_date
  from public.constancce_sync_entities e
  where e.user_id = v_link.client_id
    and e.collection = 'workout_session'
    and e.deleted_at is null;
end;
$$;

revoke all on function public.get_constancce_client_adherence(bigint) from public,anon;
grant execute on function public.get_constancce_client_adherence(bigint) to authenticated;

commit;

-- Verificação opcional após o RUN:
-- select routine_name, grantee, privilege_type from information_schema.role_routine_grants
-- where routine_schema='public' and routine_name='get_constancce_client_adherence' order by grantee;
