# Constancce 1.1.25 — Task Sync V5

## Correção estrutural

Tarefas deixam de depender da Edge Function `domain-sync` para leitura e escrita.

- leitura direta de `constancce_tasks` via REST + RLS;
- escrita via RPC `constancce_apply_my_task_ops()` usando `auth.uid()`;
- nenhuma possibilidade do cliente escolher outro `user_id`;
- fila dedicada e durável de tarefas;
- Realtime em `constancce_tasks`;
- polling dedicado de 3s como fallback;
- exclusões por tombstone;
- mutation IDs idempotentes;
- revisão por tarefa e reconciliação 3-way;
- resíduos antigos de `tasks` na fila genérica são removidos automaticamente;
- `domain-sync` continua responsável apenas pelos demais módulos.

## Validação

70 testes automatizados passaram, incluindo criação concorrente, exclusão, rebase, persistência e independência da Edge Function genérica.
