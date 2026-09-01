-- =========================================================
-- OPCIONAL — REMOVER ESTRUTURA DO GOOGLE AGENDA
-- Você pode executar este arquivo porque decidiu não integrar
-- o Google Agenda ao Constancce.
-- =========================================================

drop table if exists public.google_calendar_events cascade;
drop table if exists public.google_calendar_status cascade;
drop table if exists public.google_calendar_oauth_states cascade;
drop table if exists public.google_calendar_connections cascade;
