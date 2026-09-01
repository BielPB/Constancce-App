# Constancce 1.1.25 — Task Sync V5

> **Produção 1.1.25:** Tarefas deixam de depender da Edge Function `domain-sync`. Criação, edição e exclusão passam por uma RPC PostgreSQL autenticada e transacional (`constancce_apply_my_task_ops`), com RLS, tombstones, revisão por tarefa, fila local durável, Realtime e rebase de três vias. Execute `SUPABASE_TASK_SYNC_V5_1_1_25.sql` antes do deploy do frontend. **Não é necessário republicar `domain-sync` para esta atualização.** Consulte `GUIA_ATUALIZACAO_1.1.25.md`.

# Constancce 1.1 — Production Ready

> **Produção 1.1.16:** antes do deploy, leia `GUIA_ATUALIZACAO_SEGURANCA_1.1.16.md` e execute `SUPABASE_SECURITY_HARDENING_1_1_16.sql`. Os SQLs legados de Auth/Friends/Payment foram desativados para não reabrir permissões antigas.


Constancce é um PWA de constância e execução pessoal com hábitos, tarefas, calendário, treinos, dieta, finanças, metas, progresso, conquistas e notificações.

Esta release reorganiza a base para produção com foco em segurança, sincronização escalável, observabilidade, acessibilidade e proteção real do plano PRO no backend.

## Stack

- React 18
- Vite 5
- Tailwind CSS
- Supabase Auth + PostgreSQL + RLS + Edge Functions
- Web Push / Service Worker
- Vercel

## Estrutura principal

```text
App.jsx
main.jsx
src/
  components/
  data/
  features/
  hooks/
  lib/
  styles/
supabase/
  functions/
  sql/
tests/
public/
```

O `App.jsx` ainda concentra parte das telas mais antigas por compatibilidade, mas a migração modular já começou: UI primitives, planos, schema, observabilidade, estado, base alimentar, Notificações e Relatórios foram extraídos. Novas features devem ser criadas dentro de `src/features/` em vez de voltar a crescer o arquivo principal.

## Segurança de produção

- Dados remotos são separados por domínio em `constancce_domain_sync`.
- Escrita de domínios ocorre pela Edge Function autenticada `domain-sync`.
- Limites Free também são verificados no servidor.
- `food-search` verifica se a conta é realmente PRO no backend.
- Ledger de atividades é gravado pela Edge Function `activity-event`.
- Telemetria é gravada pela Edge Function `client-telemetry`.
- RLS impede acesso a dados de outras contas.
- CSP, HSTS, anti-frame, nosniff e Permissions Policy são enviados pela Vercel.
- O app possui Error Boundary e fila local de erros técnicos.
- Analytics de uso só são enviados com consentimento explícito do usuário.

## Sincronização

O antigo `device_sync` passa a ser somente fallback de leitura/migração. A versão nova trabalha com estes domínios:

- `account`
- `habits`
- `tasks`
- `goals`
- `workouts`
- `diet`
- `finance`

Os módulos gerais continuam usando sincronização por domínio. **Tarefas são uma exceção intencional a partir da 1.1.25:** cada tarefa possui persistência própria em `public.constancce_tasks` e as escritas usam a RPC autenticada `constancce_apply_my_task_ops`, sem depender da Edge Function `domain-sync`. O cache local continua funcionando offline e as filas pendentes são retomadas quando a conexão volta.

## Schema version

Os dados possuem `schemaVersion`. `src/lib/schema.js` normaliza automaticamente contas antigas antes de usar os dados no app.

## Desenvolvimento

Crie um `.env` local com:

```env
VITE_SUPABASE_URL=https://SEU_PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=SUA_CHAVE_PUBLICAVEL_ANON
```

Depois:

```bash
npm ci
npm run test
npm run dev
```

Para validação de produção:

```bash
npm run verify
```

`verify` executa os testes e, em seguida, o build Vite.

## Deploy

Leia **DEPLOY_PRODUCTION_READY.md** antes de publicar.

A ordem importa porque esta release bloqueia escrita direta no snapshot legado.

## Arquivos que não devem ir ao GitHub

- `.env`
- `node_modules/`
- `dist/`
- credenciais privadas
- Service Role Key
- Mercado Pago Access Token/Webhook Secret
- VAPID Private Key
- `PUSH_CRON_SECRET`

Esses itens permanecem em Environment Variables / Supabase Secrets.
