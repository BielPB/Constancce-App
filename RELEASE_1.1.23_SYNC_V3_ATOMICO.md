# Constancce 1.1.23 — Sync V3 atômico multi-dispositivo

Esta versão substitui a sincronização baseada apenas em snapshots/timestamps por uma camada de sincronização transacional com revisão monotônica por campo, mutation IDs idempotentes e reconciliação de três vias por item.

## Falha sistêmica identificada

A arquitetura 1.1.20–1.1.22 já tinha cache local durável e pull cloud-first, mas ainda possuía quatro fragilidades:

1. Coleções como `tasks` eram sincronizadas como um array inteiro. Dois dispositivos alterando o mesmo array podiam entrar em conflito.
2. O conflito era controlado por timestamps por domínio, sem uma base imutável para distinguir “item criado”, “item removido” e “item modificado”.
3. `constancce_domain_sync` e `device_sync` eram atualizados em etapas distintas, não como uma única revisão atômica da conta.
4. Um reenvio do mesmo POST não tinha ledger idempotente no banco.

O sintoma era exatamente o cenário reproduzido: uma tarefa criada no mobile permanecia local, enquanto o desktop continuava exibindo o snapshot anterior.

## Nova arquitetura

- `constancce_sync_state`: estado canônico da conta, revisionado no servidor.
- `field_revisions`: revisão monotônica independente por campo (`tasks`, `habits`, `workoutSessions`, etc.).
- `constancce_sync_mutations`: ledger de mutation IDs para impedir dupla aplicação.
- `constancce_apply_sync_patch()`: função PostgreSQL com `FOR UPDATE`; toda mutação é aplicada atomicamente.
- Reconciliação de três vias no cliente: base confirmada + edição local + estado remoto.
- Arrays de entidades são reconciliados por `id`, não substituídos cegamente.
- Exclusões usam a base da mutação para não ressuscitar itens apagados.
- Alterações em campos diferentes podem ser aplicadas sem conflito.
- Alterações simultâneas no mesmo campo retornam 409 com o estado canônico; o cliente faz rebase e tenta de novo.
- O servidor continua espelhando `device_sync` e `constancce_domain_sync` para compatibilidade com versões anteriores durante a transição.
- Poll remoto passou para 5 segundos com pull imediato em login, foco, pageshow e recuperação de internet.
- O Perfil passa a diferenciar `Sincronizado`, `Offline` e `Falha de sincronização`; falhas online não aparecem mais como se fossem apenas ausência de internet.

## Campos auditados

Todos os dados persistentes usados pelo hook principal estão na malha de sincronização:

- profile
- habits
- completions
- tasks
- goals
- unlocked
- workoutTemplates
- workoutSessions
- foods
- mealLog
- transactions
- goalProgressLog
- habitChecklistLog

## Compatibilidade

Os dados existentes não são apagados. No primeiro GET da versão nova, a Edge Function migra automaticamente o conteúdo de `device_sync` + `constancce_domain_sync` para `constancce_sync_state`.

## Obrigatório no deploy

1. Executar `SUPABASE_SYNC_V3_1_1_23.sql` no SQL Editor.
2. Publicar `domain-sync` da versão 1.1.23.
3. Publicar o frontend 1.1.23 na Vercel.
4. Executar `SUPABASE_SYNC_V3_VERIFY_1_1_23.sql` para validar.
