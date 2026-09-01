# Constancce 1.1.26 — Task Sync V6

## Objetivo
Corrigir de forma estrutural a sincronização de Tarefas entre dispositivos e separar o estado de sincronização de Tarefas do restante dos módulos.

## Causas encontradas
- O V5 ainda derivava operações comparando o array inteiro de tarefas. Uma tarefa legada inválida podia bloquear o lote inteiro.
- O estado visual de sincronização de Tarefas compartilhava `syncStatus` com o `domain-sync` genérico. Uma falha em outro módulo aparecia como falha de Tarefas.
- O retry genérico era agressivo e provocava alternância/pisca entre syncing/error.
- Havia um caso em que o pull genérico com `data: null` ignorava tarefas atômicas já disponíveis.

## Arquitetura V6
- Outbox durável por tarefa no dispositivo.
- Operações unitárias `upsert`/`delete`, nunca diff do array inteiro.
- RPC transacional `constancce_apply_my_task_op` com `auth.uid()`.
- Idempotência por `mutation_id`.
- Revisão individual e tombstones.
- Realtime + polling como fallback.
- Status de Tarefas independente do status dos demais módulos.
- Tarefas legadas sem horário não bloqueiam outras mutações; apenas novas tarefas exigem horário válido.

## Testes
73/73 testes automatizados aprovados.
