# CONSTANCCE 1.1.25 — Deploy de Produção

Para a atualização **Task Sync V5**, siga `GUIA_ATUALIZACAO_1.1.25.md`.

Ordem específica da 1.1.25:

1. Execute `SUPABASE_TASK_SYNC_V5_1_1_25.sql` no SQL Editor do Supabase.
2. Publique o frontend completo 1.1.25 na Vercel.
3. Feche e reabra o PWA/app para carregar o Service Worker v25.

**Não republique `domain-sync` para ativar esta correção.** Tarefas agora escrevem pela RPC PostgreSQL autenticada `constancce_apply_my_task_ops`; `domain-sync` continua apenas para os outros módulos.

## Segurança 1.1.16 — obrigatório

Antes de publicar esta versão, siga `GUIA_ATUALIZACAO_SEGURANCA_1.1.16.md`. A migration oficial é `SUPABASE_SECURITY_HARDENING_1_1_16.sql`; não execute os SQLs legados de Auth/Friends/Payment.

# DEPLOY — CONSTANCCE 1.1 PRODUCTION READY

Siga esta ordem no lançamento.

## 1. Faça backup

Antes da migração, faça um backup do banco Supabase ou confirme que o projeto possui backup disponível.

## 2. Suba o projeto completo no GitHub

Substitua os arquivos do repositório pelo conteúdo deste pacote mantendo `package.json` na raiz.

Não envie `.env`, `node_modules` ou `dist`.

Ainda não faça o deploy final da Vercel se o SQL e as novas Edge Functions não estiverem preparados.

## 3. Supabase — execute o SQL

Abra:

`supabase/sql/PRODUCTION_HARDENING_SQL.sql`

Copie o conteúdo para **Supabase > SQL Editor** e execute uma vez.

Ele cria:

- `constancce_domain_sync`
- `constancce_events`
- `constancce_activity_events`
- índices
- RLS
- política de leitura do snapshot legado
- bloqueio de escrita direta no `device_sync`

## 4. Supabase — deploy das Edge Functions novas

Crie/deploy:

### domain-sync
Arquivo:
`supabase/functions/domain-sync/index.ts`

Verify JWT: **ON**

### client-telemetry
Arquivo:
`supabase/functions/client-telemetry/index.ts`

Verify JWT: **ON**

### activity-event
Arquivo:
`supabase/functions/activity-event/index.ts`

Verify JWT: **ON**

## 5. Atualize as Edge Functions existentes

### food-search
Substitua pelo arquivo:
`supabase/functions/food-search/index.ts`

Verify JWT: **ON**

### send-due-notifications
Substitua pelo arquivo:
`supabase/functions/send-due-notifications/index.ts`

Verify JWT: **OFF**

A proteção desta função continua sendo `PUSH_CRON_SECRET`.

### delete-account
Atualize com:
`supabase/functions/delete-account/index.ts`

Verify JWT: **ON**

Ela agora também remove domain sync, ledger e telemetria.

## 6. Secrets

Esta atualização não cria uma nova chave externa obrigatória.

Mantenha os secrets já usados pelas funções anteriores, incluindo os de Push e Mercado Pago.

As funções usam também as variáveis padrão do projeto Supabase:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

## 7. Vercel — Environment Variables

Confirme:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

O `vercel.json` já contém os headers de segurança da aplicação.

## 8. Deploy da Vercel

Faça o deploy da branch/repositório atualizado.

A Vercel deve executar:

```text
npm run build
```

## 9. Teste obrigatório pós-deploy

Teste uma conta Free e uma conta PRO.

### Conta Free

- login/logout
- criar hábito até o limite
- criar tarefa até o limite
- criar treino até o limite
- criar meta até o limite
- adicionar alimento
- sincronizar em dois aparelhos/abas
- tentar usar produto por código de barras e confirmar bloqueio PRO

### Conta PRO

- produtos online
- código de barras
- Intelligence
- lembretes inteligentes
- salvar mais itens que o limite Free
- sincronização entre dispositivos

### Geral

- concluir hábito
- concluir tarefa comum
- concluir tarefa recorrente
- concluir treino
- concluir meta
- verificar XP
- verificar streak
- registrar dieta
- lançamento financeiro
- notificações Push
- exclusão de conta

## 10. Notificações

Confirme que o cron de `send-due-notifications` continua ativo.

Agora o usuário PRO pode escolher:

- Discreto — sem repetição horária de tarefa atrasada
- Equilibrado — a cada 2 horas
- Persistente — a cada 1 hora

A ação da notificação permite concluir ou adiar a tarefa por 1 hora.

## 11. Migração

Contas antigas são migradas automaticamente para `constancce_domain_sync` durante o uso.

O `device_sync` não é apagado nesta release. Ele permanece como fallback de leitura durante a transição, sem escrita direta do frontend.

## 12. Rollback

Se houver um problema imediatamente após o lançamento:

1. reverta o deploy da Vercel para a versão anterior;
2. não apague `device_sync`;
3. mantenha as novas tabelas intactas;
4. corrija a aplicação antes de alterar políticas novamente.

Não delete dados durante um rollback.


## Atualização 1.1.19 — tarefas e notificações

Após publicar o frontend 1.1.19:

```bash
npx supabase functions deploy domain-sync --project-ref opuirvfoxrqfkvbihfbs --use-api
npx supabase functions deploy send-due-notifications --project-ref opuirvfoxrqfkvbihfbs --use-api
```

O cron de `send-due-notifications` deve rodar a cada 5 minutos (`*/5 * * * *`) para melhorar a precisão do lembrete de 30 minutos. Nenhum SQL novo é necessário se o Web Push já estiver configurado.
