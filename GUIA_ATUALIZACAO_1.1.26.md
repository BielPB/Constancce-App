# Guia de atualização — Constancce 1.1.26

## Ordem obrigatória

### 1. Atualizar o Supabase
No Dashboard do Supabase:

SQL Editor → New query → cole TODO o arquivo:

`SUPABASE_TASK_SYNC_V6_1_1_26.sql`

Clique em Run.

### 2. Verificar a instalação
Abra outra query e rode:

`SUPABASE_TASK_SYNC_V6_VERIFY_1_1_26.sql`

O esperado é que:
- `authenticated_pode_executar` = true
- `authenticated_pode_ler` = true
- `authenticated_pode_inserir_direto` = false

### 3. Publicar o frontend completo
Faça deploy do pacote 1.1.26 na Vercel.

Não é necessário republicar `domain-sync` para corrigir Tarefas. O Task Sync V6 não depende dessa Edge Function para criar, editar ou excluir tarefas.

### 4. Atualizar o app instalado
Depois do deploy:
- Desktop: faça hard refresh.
- iPhone/PWA: feche totalmente e abra novamente.
- Se o PWA permanecer com versão antiga em cache, remova o atalho e instale novamente somente como último recurso.

## Teste recomendado
1. No Mac crie `SYNC V6 MAC` com horário.
2. Aguarde aparecer `Tarefas sincronizadas`.
3. No celular, na mesma conta, a tarefa deve aparecer via Realtime ou no fallback de polling.
4. Exclua a tarefa no celular.
5. O Mac deve removê-la sem apagar as demais.

Para conferir no banco:

```sql
select
  task_id,
  payload->>'title' as titulo,
  revision,
  deleted_at,
  updated_at
from public.constancce_tasks
order by updated_at desc;
```

Criação: `deleted_at` nulo.
Exclusão: `deleted_at` preenchido.
