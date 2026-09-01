# Atualização 1.1.25 — Task Sync V5

## Ordem obrigatória

1. Supabase > SQL Editor > New query.
2. Execute TODO `SUPABASE_TASK_SYNC_V5_1_1_25.sql`.
3. Execute `SUPABASE_TASK_SYNC_V5_VERIFY_1_1_25.sql` e confira que as funções e políticas existem.
4. Publique o frontend 1.1.25 na Vercel.
5. Não é necessário republicar `domain-sync` para esta correção de Tarefas.

## Teste de produção

- Mac: criar `TESTE MAC V5`.
- Celular: deve aparecer via Realtime ou em até ~3s pelo fallback.
- Celular: criar `TESTE MOBILE V5`.
- Mac: deve aparecer.
- Celular: excluir `TESTE MOBILE V5`.
- Mac: deve desaparecer sem afetar as demais.

## Diagnóstico SQL

```sql
select task_id, payload->>'title' as titulo, revision, deleted_at, updated_at
from public.constancce_tasks
order by updated_at desc;
```

Uma exclusão correta mantém a linha e preenche `deleted_at`.
