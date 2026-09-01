# Atualização 1.1.24 — Task Sync V4

A ordem abaixo é obrigatória.

## 1. Backup
Faça backup do Supabase antes da migration.

## 2. SQL
No Supabase > SQL Editor > New query, execute TODO o conteúdo de:

`SUPABASE_TASK_SYNC_V4_1_1_24.sql`

Esse arquivo cria `constancce_tasks`, tombstones, ledger de mutations, RPC atômica, policy SELECT própria e adiciona a tabela à publication `supabase_realtime`.

Não apaga tarefas antigas. Na primeira leitura de cada conta, o backend importa automaticamente as tarefas do snapshot legado se a tabela nova ainda estiver vazia.

## 3. Edge Function
No terminal, dentro da pasta 1.1.24:

```bash
npx supabase functions deploy domain-sync --project-ref opuirvfoxrqfkvbihfbs --use-api
```

## 4. Frontend
Só depois dos passos 2 e 3, publique o projeto completo na Vercel.

A versão inclui `@supabase/supabase-js` para o canal Realtime de tarefas. O package-lock foi removido intencionalmente do pacote para o ambiente de deploy instalar a dependência declarada no `package.json`.

## 5. Validação
Execute no SQL Editor:

`SUPABASE_TASK_SYNC_V4_VERIFY_1_1_24.sql`

Confira que:
- existem rows em `constancce_tasks`;
- tarefas ativas aparecem com `deleted_at is null`;
- exclusões aparecem com `deleted_at` preenchido;
- `supabase_realtime` contém `public.constancce_tasks`;
- policy `constancce_tasks_select_own` existe.

## 6. Teste de produção
Dispositivo A:
1. Entre na conta.
2. Crie `TESTE MAC`.
3. Aguarde o indicador voltar para Sincronizado.

Dispositivo B:
1. Mesma conta.
2. A tarefa deve aparecer via Realtime; polling de 5 s é fallback.
3. Crie `TESTE CELULAR`.

Os dois dispositivos devem mostrar as duas tarefas.

Depois exclua `TESTE CELULAR` em um aparelho. O outro deve removê-la sem remover `TESTE MAC`.

## Diagnóstico
Se ainda houver falha, abra Supabase > Edge Functions > domain-sync > Invocations. POSTs devem retornar 200; em conflito legítimo pode haver 409 seguido de reconciliação automática.
