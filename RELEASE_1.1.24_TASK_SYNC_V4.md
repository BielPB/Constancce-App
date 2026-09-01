# Constancce 1.1.24 — Task Sync V4

Correção estrutural da sincronização de Tarefas para múltiplos dispositivos.

## Causa raiz
A aba Tarefas ainda dependia de snapshots JSON do array inteiro. Mesmo com revisão por domínio, isso mantinha criação, edição e exclusão acopladas ao mesmo campo `tasks`, permitindo divergência entre dispositivos e reconciliações difíceis.

## Nova arquitetura
- `constancce_tasks`: uma linha por tarefa e usuário.
- revisão monotônica por tarefa.
- `deleted_at` como tombstone para exclusões.
- ledger idempotente `constancce_task_mutations`.
- RPC `constancce_apply_task_ops` serializada por conta.
- upserts stale entram em conflito em vez de sobrescrever dados novos.
- exclusão explícita vence edição antiga e não é ressuscitada.
- `domain-sync` injeta as tarefas atômicas em todo GET da conta.
- Realtime do Supabase dispara pull imediato nos outros dispositivos.
- polling de 5 s permanece somente como fallback.
- sincronização antiga permanece como espelho de compatibilidade.

## Segurança
Frontend recebe SELECT apenas das próprias linhas via RLS. INSERT/UPDATE/DELETE continuam sem grant para `authenticated`; toda escrita passa por `domain-sync` usando service role no servidor.
