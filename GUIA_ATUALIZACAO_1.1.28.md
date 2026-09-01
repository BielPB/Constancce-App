# Guia de atualização — Constancce 1.1.28

Esta atualização sincroniza **Hábitos e Treinos** usando persistência atômica própria.

## Ordem obrigatória

### 1. Execute a migration no Supabase

Abra **Supabase → SQL Editor → New query**, cole todo o conteúdo de:

`SUPABASE_ROUTINE_SYNC_V1_1_1_28.sql`

e clique em **Run**.

A migration cria:

- `public.constancce_sync_entities`
- `public.constancce_entity_mutations`
- RPC `public.constancce_apply_my_entity_op(...)`
- RLS de leitura por `auth.uid()`
- Realtime para a tabela de entidades
- backfill seguro a partir do estado já existente

### 2. Execute o verificador

Rode:

`SUPABASE_ROUTINE_SYNC_V1_VERIFY_1_1_28.sql`

Você deve ver coleções como:

- `habit`
- `habit_completion`
- `habit_checklist`
- `workout_template`
- `workout_session`

### 3. Publique o frontend completo na Vercel

Suba o conteúdo completo da versão 1.1.28.

**Não precisa republicar `domain-sync`.**

**Não execute novamente o SQL de Tarefas.** O Task Sync V6 foi preservado.

## Teste recomendado

1. No celular, marque uma etapa de um hábito.
2. Aguarde até 3 segundos e confira no Mac.
3. Conclua um hábito inteiro no celular e confira no Mac.
4. No celular, conclua um treino.
5. Confira no Mac se o mesmo treino aparece como concluído, com séries/cargas preservadas.
6. Faça uma alteração no Mac e valide no celular.

O Realtime normalmente atualiza quase imediatamente; o polling de 3 segundos é apenas fallback.
