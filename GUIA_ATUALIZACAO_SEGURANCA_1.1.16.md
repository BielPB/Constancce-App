# Constancce 1.1.16 — Guia de atualização de segurança

> **Objetivo:** endurecer banco, autenticação, Edge Functions e checkout sem perder os dados existentes.
>
> **Ordem recomendada:** backup → secrets → SQL → Edge Functions → Auth → frontend/Vercel → testes.

## 0. Antes de começar

1. Faça um backup do banco no Supabase (ou confirme que o backup/PITR do projeto está ativo).
2. Não apague as tabelas existentes.
3. Não rode os SQLs antigos depois desta migration. A partir desta versão, o arquivo oficial de segurança é `SUPABASE_SECURITY_HARDENING_1_1_16.sql`.
4. Se você tinha um usuário com PRO temporário **manual** e ele chegou a clicar no checkout usando uma versão antiga que mudou `payment_status` para `pending`, anote o e-mail. Depois da migration, basta conceder o período novamente com `grant_constancce_pro`.

---

## 1. Configure os Secrets das Edge Functions

No Supabase Dashboard:

**Edge Functions → Secrets**

Garanta estes valores:

```text
CONSTANCCE_APP_URL=https://constancce-app.vercel.app
CONSTANCCE_ALLOWED_ORIGINS=https://constancce-app.vercel.app
ENVIRONMENT=production
MERCADOPAGO_ACCESS_TOKEN=<seu access token de produção>
MERCADOPAGO_WEBHOOK_SECRET=<assinatura secreta do webhook>
```

Se usa notificações push, mantenha também:

```text
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=...
PUSH_CRON_SECRET=...
```

**Nunca** coloque `SUPABASE_SERVICE_ROLE_KEY`, `MERCADOPAGO_ACCESS_TOKEN` ou `MERCADOPAGO_WEBHOOK_SECRET` no frontend/Vercel como variável `VITE_*`.

Se tiver outro domínio oficial além da Vercel, use lista separada por vírgulas em `CONSTANCCE_ALLOWED_ORIGINS`, por exemplo:

```text
https://constancce-app.vercel.app,https://app.seudominio.com.br
```

---

## 2. Execute a migration de segurança

No Supabase:

**SQL Editor → New query**

Abra o arquivo:

`SUPABASE_SECURITY_HARDENING_1_1_16.sql`

Copie **todo** o conteúdo, cole no SQL Editor e clique em **Run**.

O script:

- mantém contas existentes;
- coloca novas contas em **Free**;
- preserva PRO vitalício;
- preserva trial manual identificado por `complimentary_trial`;
- remove trials automáticos antigos;
- ativa/reforça RLS;
- bloqueia escrita direta nas tabelas de sync;
- permite leitura apenas do próprio usuário e apenas com e-mail confirmado;
- restringe RPCs administrativas;
- cria rate limiting server-side;
- cria ledger de checkout/pagamentos;
- endurece amigos/perfis;
- aplica privilégios mínimos a objetos futuros.

### 2.1. Como liberar PRO temporário depois da migration

Somente no **SQL Editor**, para um e-mail já confirmado:

```sql
select public.grant_constancce_pro(
  'cliente@gmail.com',
  30
);
```

Para 7, 15 ou 60 dias, altere apenas o número.

Usuários comuns (`anon` e `authenticated`) não têm permissão para executar essa função.

---

## 3. Publique as Edge Functions da versão 1.1.16

Esta versão usa um módulo compartilhado em:

`supabase/functions/_shared/security.ts`

Por isso, o método mais seguro é publicar a pasta `supabase/functions` com a Supabase CLI.

### Opção recomendada — Supabase CLI

No terminal, dentro da pasta do projeto:

```bash
npx supabase login
```

Depois vincule o projeto. O `PROJECT_REF` é a parte anterior a `.supabase.co` na URL do projeto:

```bash
npx supabase link --project-ref SEU_PROJECT_REF
```

Então publique as funções:

```bash
npx supabase functions deploy create-mercadopago-checkout
npx supabase functions deploy mercadopago-webhook
npx supabase functions deploy domain-sync
npx supabase functions deploy activity-event
npx supabase functions deploy client-telemetry
npx supabase functions deploy food-search
npx supabase functions deploy push-subscription
npx supabase functions deploy delete-account
npx supabase functions deploy send-due-notifications
```

O arquivo `supabase/config.toml` já define quais funções usam JWT e quais precisam ficar públicas para webhook/cron.

### Depois de publicar

Abra no Dashboard:

**Edge Functions → cada função → Invocations/Logs**

Faça um teste no app e confirme que não há `401`, `403` ou `500` inesperados.

---

## 4. Exija confirmação de e-mail

No Supabase Dashboard:

**Authentication → Providers / Sign In → Email**

Ative a opção de **Confirm Email / Confirm email address**.

Com isso:

- cadastro cria a conta;
- o usuário recebe um e-mail;
- ele não consegue usar o Constancce até confirmar;
- o frontend 1.1.16 também bloqueia sessões sem `email_confirmed_at`;
- as Edge Functions 1.1.16 repetem essa validação no servidor;
- as policies principais do banco também verificam confirmação.

### URL de autenticação

Em **Authentication → URL Configuration**:

```text
Site URL:
https://constancce-app.vercel.app
```

Em Redirect URLs, inclua o domínio de produção usado pelo app, por exemplo:

```text
https://constancce-app.vercel.app/**
```

Se tiver domínio próprio, inclua também o domínio próprio.

---

## 5. Política de senha

O frontend 1.1.16 já exige:

- mínimo de 10 caracteres;
- letra minúscula;
- letra maiúscula;
- número;
- símbolo.

No Supabase, vá às configurações de Auth/Password e configure uma política compatível ou mais forte. Se sua opção/plano oferecer proteção contra senhas vazadas, ative-a.

A alteração de senha dentro do Constancce também exige a senha atual.

---

## 6. Rate limits do Auth

Abra:

**Authentication → Rate Limits**

O Supabase já protege endpoints de Auth. Não aumente os limites sem necessidade.

Para produção com crescimento, revise principalmente:

- signup;
- reenvio de confirmação;
- recuperação de senha;
- OTP/magic link, se futuramente usar;
- token refresh.

Além disso, a versão 1.1.16 adiciona limites próprios nas Edge Functions, incluindo checkout, sync, busca de alimentos, push, telemetria e exclusão de conta.

---

## 7. Configure SMTP de produção

Como agora a confirmação de e-mail é obrigatória, não dependa do SMTP de testes do Supabase.

No Dashboard:

**Authentication → Emails → SMTP Settings**

Configure um provedor de e-mail transacional de produção (por exemplo, Resend, SendGrid, Amazon SES ou outro SMTP confiável).

Depois teste:

1. cadastro;
2. confirmação;
3. reenvio da confirmação;
4. recuperação de senha;
5. alteração de e-mail.

Se seu provedor tiver **link tracking**, desative para os e-mails de autenticação para evitar alterar URLs de confirmação.

---

## 8. SSL do banco

No Supabase:

**Database Settings → SSL Configuration**

Ative:

**Enforce SSL on incoming connections**

Isso endurece conexões diretas ao Postgres/pooler. A ativação pode provocar um breve reboot do banco, então faça fora do pico.

---

## 9. Network Restrictions — opcional, mas recomendado se você souber seus IPs

Em:

**Database Settings → Network Restrictions**

Você pode permitir conexão direta ao Postgres apenas a IPs/CIDRs conhecidos.

Isso não é necessário para o funcionamento normal do frontend via APIs HTTPS, mas pode proteger conexões diretas ao banco.

**Não ative uma allowlist restritiva se você não tiver certeza dos IPs que precisa permitir**, pois pode bloquear suas ferramentas administrativas externas.

---

## 10. Proteja sua conta/organização Supabase

Ative MFA na sua própria conta Supabase e, se houver equipe, exija MFA dos membros administrativos.

Não compartilhe credenciais de owner/admin.

Se alguma `service_role`/secret key já tiver sido colocada em frontend, Git público, print público ou arquivo entregue a terceiros, rotacione a chave.

---

## 11. Mercado Pago

Você não precisa alterar o preço no frontend. A versão 1.1.16 fixa no **servidor**:

```text
Produto: Constancce PRO Founder — Acesso Vitalício
Valor: R$ 37,90
Moeda: BRL
```

A Edge Function agora:

- ignora valores enviados pelo navegador;
- cria uma sessão interna de checkout;
- usa idempotência;
- aceita apenas URL de checkout do Mercado Pago;
- associa pagamento ao usuário autenticado.

O webhook valida:

- assinatura `x-signature`;
- pagamento consultado na API do Mercado Pago;
- valor;
- moeda;
- produto;
- usuário;
- preferência/sessão interna;
- processamento duplicado.

No Mercado Pago, mantenha a URL do webhook:

```text
https://SEU_PROJECT_REF.supabase.co/functions/v1/mercadopago-webhook
```

E o evento de **Payments/Pagamentos** ativo.

---

## 12. Faça deploy do frontend na Vercel

Depois de terminar Supabase/Edge Functions, publique a pasta desta versão na Vercel.

A versão inclui headers de segurança em `vercel.json`:

- Content-Security-Policy;
- HSTS;
- `X-Frame-Options: DENY`;
- `X-Content-Type-Options: nosniff`;
- Referrer Policy;
- Permissions Policy;
- proteção contra objetos/plugins e framing.

Se adicionar futuramente um domínio/API/vídeo externo, talvez seja necessário permitir explicitamente a origem no CSP. Não troque o CSP por `*` para “resolver”.

---

## 13. Testes obrigatórios após a atualização

### Cadastro

1. Crie uma conta com um e-mail novo.
2. Antes de confirmar, tente entrar → deve ser bloqueado.
3. Clique no e-mail de confirmação.
4. Entre novamente → deve funcionar.
5. Perfil deve começar como **Free**, não PRO 30d.

### PRO temporário

Rode:

```sql
select public.grant_constancce_pro('EMAIL_CONFIRMADO@gmail.com',30);
```

O Perfil deve mostrar o contador de 30 dias.

Teste com e-mail ainda não confirmado → deve retornar:

```text
E-mail ainda não confirmado
```

### Checkout

1. Usuário confirmado toca em “Garantir PRO Vitalício”.
2. Supabase → Edge Functions → `create-mercadopago-checkout` → Invocations deve mostrar `200`.
3. O Mercado Pago deve abrir.
4. Após pagamento aprovado, `mercadopago-webhook` deve receber o evento.
5. `constancce_access.plan` deve virar `lifetime` somente após validação do backend.

### RLS / sync

O app deve continuar salvando normalmente por `domain-sync`.

No REST direto, o usuário não deve possuir `INSERT`, `UPDATE` ou `DELETE` em `constancce_domain_sync`/`device_sync`.

### Exclusão de conta

No Perfil, excluir conta deve exigir a senha atual. Uma senha incorreta deve impedir a exclusão.

---

## 14. Verificação rápida do banco

Também acompanha a versão o arquivo:

`SUPABASE_SECURITY_VERIFY_1_1_16.sql`

Execute-o **depois** da migration. Ele apenas consulta configurações/permissões; não deve alterar dados.

---

## 15. Sobre Storage

A versão atual do Constancce não usa um bucket Supabase Storage como mecanismo principal de upload; imagens de perfil atuais não dependem de bucket público. Por isso, esta migration **não cria nem abre nenhum bucket**.

Quando você decidir hospedar vídeos de exercícios ou imagens no Supabase Storage, use bucket privado/controle de acesso e policies por `auth.uid()` em vez de um bucket público irrestrito.

---

## Checklist final

- [ ] Backup confirmado
- [ ] Secrets configurados
- [ ] `SUPABASE_SECURITY_HARDENING_1_1_16.sql` executado
- [ ] Edge Functions 1.1.16 publicadas
- [ ] Confirm Email ativado
- [ ] Site URL/Redirect URLs conferidos
- [ ] Política de senha revisada
- [ ] SMTP de produção configurado
- [ ] SSL do Postgres ativado
- [ ] MFA da sua conta Supabase ativado
- [ ] Frontend 1.1.16 publicado na Vercel
- [ ] Conta nova testada como Free
- [ ] E-mail não confirmado bloqueado
- [ ] Trial manual testado
- [ ] Checkout real testado
- [ ] `SUPABASE_SECURITY_VERIFY_1_1_16.sql` executado e revisado
