# Constancce 1.1.16 — Security Hardening

## Segurança aplicada

- E-mail confirmado obrigatório no frontend, RLS principal e Edge Functions autenticadas.
- Senha forte no cadastro e alteração; alteração/exclusão sensível exige senha atual.
- RLS e privilégios mínimos nas tabelas críticas.
- Escrita direta em `device_sync` e `constancce_domain_sync` removida; sync passa pelo backend.
- PRO temporário apenas administrativo e apenas para e-mail confirmado.
- Novos usuários sempre Free.
- Edge Functions com CORS por allowlist e rate limiting server-side.
- Checkout Mercado Pago com preço/produto server-side, sessão interna e idempotência.
- Webhook Mercado Pago com assinatura e reconciliação da API, valor/moeda/produto/usuário/sessão validados.
- Ledger contra processamento duplicado.
- Exclusão de conta com reautenticação de senha no backend.
- CSP, HSTS, anti-frame, nosniff e demais headers na Vercel.
- SQLs antigos sem e-mails privilegiados hardcoded.
- Nenhuma secret/service role incorporada no frontend.

## Arquivos principais

- `SUPABASE_SECURITY_HARDENING_1_1_16.sql`
- `SUPABASE_SECURITY_VERIFY_1_1_16.sql`
- `GUIA_ATUALIZACAO_SEGURANCA_1.1.16.md`
- `supabase/functions/_shared/security.ts`

## Validação

44 testes automatizados passaram nesta versão.

O build Vite não foi executado neste ambiente porque o pacote original não contém `node_modules` instalados.
