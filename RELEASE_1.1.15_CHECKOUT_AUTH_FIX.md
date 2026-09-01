# Constancce 1.1.15 — Checkout/Auth Fix

## Correções

- Corrigido crash `ReferenceError: ProUpgradeModal is not defined` ao abrir o paywall PRO.
- Adicionado modal PRO real para usuários Free, com compra vitalícia e verificação de pagamento.
- Sessão Supabase é renovada preventivamente antes do checkout.
- Se a Edge Function retornar 401, o app força refresh do JWT e repete o checkout uma única vez.
- Sessão é mantida atualizada enquanto o app permanece aberto por longos períodos.
- Erros do checkout passam a aparecer no Perfil durante o PRO temporário, em vez de falharem silenciosamente.
- Erros de pagamento são enviados à camada de observabilidade do cliente.

## Validação

- 39 testes automatizados aprovados.
