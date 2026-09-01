# Constancce 1.1.28 — Hábitos + Treinos Sync Atômico

Escopo desta versão: **somente sincronização de Hábitos e Treinos**. O Task Sync V6 da 1.1.26 foi preservado sem alterações em seu arquivo de implementação e migration.

## O que mudou

- Hábitos deixam de depender da `domain-sync` genérica para escrita.
- Conclusões de hábitos e checklist diário são gravados por entidade no Supabase.
- Templates e sessões de treino são gravados por entidade no Supabase.
- Cada entidade possui revisão própria, mutation id e tombstone de exclusão.
- Fila offline durável por conta.
- Realtime do Supabase para atualização imediata em outro dispositivo.
- Polling de 3 segundos como fallback do Realtime.
- Migração defensiva preserva progresso que existia apenas no cache local do dispositivo.
- O snapshot genérico não pode mais regredir Hábitos ou Treinos.
- Limites Free de 5 hábitos ativos e 2 templates de treino também são validados na RPC.

## Arquivos Supabase

1. `SUPABASE_ROUTINE_SYNC_V1_1_1_28.sql`
2. `SUPABASE_ROUTINE_SYNC_V1_VERIFY_1_1_28.sql`

Não é necessário republicar `domain-sync` para esta alteração.
