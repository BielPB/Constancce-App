# Constancce — pagamento vitalício R$ 37,90

Esta versão implementa:

- 30 dias de teste Pro para cada conta.
- Paywall automático ao fim do teste, sem apagar os dados.
- Checkout Pro do Mercado Pago por R$ 37,90, pagamento único.
- Liberação automática do plano `lifetime` após Webhook confirmado.
- Selo `Founder vitalício` dentro do app.
- Dados de pagamento controlados no backend; o navegador não consegue se tornar Pro sozinho.

## 1. Banco do Supabase

Abra **Supabase → SQL Editor** e execute uma única vez:

`SUPABASE_PAYMENT_SETUP.sql`

Usuários atuais recebem 30 dias de teste a partir do momento em que esse SQL for executado. Novas contas recebem 30 dias automaticamente ao serem criadas.

## 2. Criar aplicação no Mercado Pago

No Mercado Pago Developers, crie/abra sua aplicação e obtenha o **Access Token de produção**.

Não coloque esse token no React, GitHub ou Vercel.

## 3. Secrets das Edge Functions

No Supabase, configure estes secrets:

- `MERCADOPAGO_ACCESS_TOKEN` = Access Token de produção do Mercado Pago
- `MERCADOPAGO_WEBHOOK_SECRET` = assinatura secreta gerada na configuração de Webhooks do Mercado Pago
- `CONSTANCCE_APP_URL` = URL pública do app, por exemplo `https://seu-app.vercel.app`

Os secrets `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` já ficam disponíveis para Edge Functions hospedadas no Supabase.

## 4. Publicar as Edge Functions

Com Supabase CLI, na raiz do projeto:

```bash
supabase login
supabase link --project-ref SEU_PROJECT_REF
supabase functions deploy create-mercadopago-checkout
supabase functions deploy mercadopago-webhook --no-verify-jwt
```

Depois configure os secrets pelo Dashboard ou CLI.

## 5. Webhook no Mercado Pago

Em **Suas integrações → sua aplicação → Webhooks**, use como URL de produção:

`https://SEU_PROJECT_REF.supabase.co/functions/v1/mercadopago-webhook`

Ative o evento **Pagamentos / Payments** e salve. O Mercado Pago mostrará uma assinatura secreta; copie-a para `MERCADOPAGO_WEBHOOK_SECRET` no Supabase.

## 6. Fluxo final

1. Usuário cria conta.
2. Banco cria `trial_ends_at = agora + 30 dias`.
3. Durante o teste, o app mostra `Teste Pro · Xd`.
4. Ao vencer, os dados continuam salvos e aparece o paywall.
5. Usuário toca em **Desbloquear acesso vitalício**.
6. O backend cria uma preferência de R$ 37,90 no Mercado Pago.
7. O usuário paga no Checkout Pro.
8. Mercado Pago chama o Webhook.
9. O Webhook consulta o pagamento diretamente na API do Mercado Pago e valida valor/status/usuário.
10. Se aprovado, `plan = lifetime` e `payment_status = approved`.
11. O app libera o acesso e mostra `Founder vitalício`.

## Segurança

Nunca use `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET` ou `SUPABASE_SERVICE_ROLE_KEY` no frontend.
