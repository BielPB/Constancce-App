# Constancce 1.1.27 — Correção de status da sincronização geral

Alteração isolada solicitada pelo usuário.

## O que mudou

- O Task Sync V6 da versão 1.1.26 foi preservado sem alterações.
- A interface só informa `Outros dados aguardam confirmação` quando existe uma fila genérica realmente pendente.
- Falhas de leitura/verificação remota com fila vazia não são mais apresentadas como dados não salvos.
- Em falha de consulta sem pendências, o status não entra em erro de confirmação.
- O Perfil diferencia falha temporária de leitura de uma alteração efetivamente pendente.

## O que NÃO mudou

- Task Sync V6.
- RPCs de tarefas.
- Realtime de tarefas.
- domain-sync.
- SQL do Supabase.
- Filas de escrita.
- Reconciliação entre dispositivos.
- Mercado Pago, Auth, Dieta, Finanças, Treinos, Hábitos, Metas ou outras áreas.

## Deploy

Somente frontend. Não é necessário executar SQL ou republicar Edge Functions.
