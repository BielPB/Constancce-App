# Constancce 1.1.14 — Free por padrão

## Correção principal

- Novas contas não recebem mais 30 dias de PRO automaticamente.
- Toda nova conta comum começa no plano `free`.
- PRO temporário só é reconhecido quando foi concedido manualmente com `grant_constancce_pro(...)`.
- O marcador `payment_status = complimentary_trial` passa a ser obrigatório para um trial administrativo ser tratado como PRO.
- Trials automáticos antigos (`payment_status != complimentary_trial`) são convertidos para Free pela migration.
- Usuários vitalícios permanecem intocados.

## Segurança

- A função `grant_constancce_pro` não pode ser executada por `anon` ou `authenticated` via RPC.
- Apenas SQL Editor/role administrativa ou `service_role` podem conceder PRO temporário.
- Reembolsos/chargebacks agora retornam o usuário para `free`, nunca para `trial`.

## Deploy obrigatório

Após publicar o frontend/Edge Functions, execute uma única vez:

`SUPABASE_FREE_DEFAULT_MIGRATION.sql`

no SQL Editor do Supabase.
