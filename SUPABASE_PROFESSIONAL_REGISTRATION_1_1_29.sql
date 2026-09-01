-- ============================================================================
-- CONSTANCCE 1.1.29 — REGISTRO PROFISSIONAL (CREF/CRN) NO CONVITE
-- Execute UMA VEZ no Supabase SQL Editor, depois de
-- SUPABASE_PROFESSIONAL_LINKS_1_1_29.sql.
--
-- O Constancce NÃO verifica credenciais — este número é só um dado que o
-- profissional informa e que fica visível para quem recebe o convite, para
-- que a pessoa possa conferir por conta própria (site do CREF/CRN) antes de
-- aceitar. Puramente informativo/rastreável, não é validado contra nenhum
-- órgão externo.
-- ============================================================================

begin;

alter table public.constancce_professional_links
  add column if not exists professional_registration text;

drop function if exists public.invite_constancce_client(text, text);

create or replace function public.invite_constancce_client(p_email text, p_link_type text, p_registration text default null)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare v_me uuid:=auth.uid(); v_client uuid; v_existing bigint; v_allowed boolean; v_is_pro boolean; v_registration text;
begin
  if v_me is null or not public.constancce_email_verified() then raise exception 'unauthorized'; end if;
  if p_link_type not in ('personal','nutricionista') then raise exception 'invalid link type'; end if;
  if length(trim(coalesce(p_email,'')))<5 or length(trim(p_email))>254 or position('@' in p_email)<2 then raise exception 'invalid email'; end if;

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
  where a.user_id = v_me;
  if not coalesce(v_is_pro, false) then raise exception 'pro_required'; end if;

  select public.consume_constancce_rate_limit('proflink:'||v_me::text,20,86400) into v_allowed;
  if not coalesce(v_allowed,false) then raise exception 'too many requests'; end if;

  select p.user_id into v_client
  from public.constancce_profiles p join auth.users u on u.id=p.user_id and u.email_confirmed_at is not null
  where lower(p.email)=lower(trim(p_email)) limit 1;
  if v_client is null then raise exception 'user not found'; end if;
  if v_client=v_me then raise exception 'cannot add yourself'; end if;

  select id into v_existing from public.constancce_professional_links
  where professional_id=v_me and client_id=v_client and link_type=p_link_type limit 1;
  if v_existing is not null then raise exception 'link already exists'; end if;

  v_registration := nullif(trim(coalesce(p_registration,'')),'');
  if v_registration is not null and length(v_registration) > 60 then
    v_registration := left(v_registration, 60);
  end if;

  insert into public.constancce_professional_links(professional_id,client_id,link_type,status,professional_registration)
  values(v_me,v_client,p_link_type,'pending',v_registration);
  return jsonb_build_object('ok',true);
end;
$$;

revoke all on function public.invite_constancce_client(text,text,text) from public,anon;
grant execute on function public.invite_constancce_client(text,text,text) to authenticated;

drop function if exists public.get_constancce_professional_links();

create or replace function public.get_constancce_professional_links()
returns table(
  link_id bigint,
  direction text,
  link_type text,
  status text,
  user_id uuid,
  email text,
  display_name text,
  avatar_data_url text,
  professional_registration text
)
language sql security definer set search_path=public,auth stable as $$
  select l.id,
    case when l.professional_id=auth.uid() then 'as_professional' else 'as_client' end,
    l.link_type, l.status, p.user_id, p.email, p.display_name, p.avatar_data_url,
    l.professional_registration
  from public.constancce_professional_links l
  join public.constancce_profiles p
    on p.user_id = case when l.professional_id=auth.uid() then l.client_id else l.professional_id end
  where public.constancce_email_verified() and (l.professional_id=auth.uid() or l.client_id=auth.uid())
  order by case when l.status='pending' then 0 else 1 end, l.created_at desc;
$$;

revoke all on function public.get_constancce_professional_links() from public,anon;
grant execute on function public.get_constancce_professional_links() to authenticated;

commit;

-- Verificação opcional após o RUN:
-- select column_name from information_schema.columns
-- where table_schema='public' and table_name='constancce_professional_links' order by column_name;
