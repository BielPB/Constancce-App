# CONSTANCCE — NOTIFICAÇÕES COM TÍTULO LIMPO

Base:
CONSTANCCE-NOTIFICACAO-TITULO-SIMPLES.zip

## Alteração
Foi removido o prefixo automático `Constancce -` dos títulos Web Push.

Exemplo da notificação horária:

Antes:
`Constancce - Seu próximo passo`

Agora:
`Seu próximo passo`

O navegador/sistema operacional pode continuar exibindo separadamente:
`From Constancce`

Essa identificação é controlada pelo navegador/sistema e passa a funcionar como identificação da origem sem repetir o nome do app no título.

## Outros títulos
As demais notificações também passam a usar somente o título da ação, por exemplo:
- Tarefa pendente
- Tarefa pendente · atrasada
- Treino programado
- Conta vence hoje
- Hora da revisão semanal

## Deploy
Reimplantar:
`supabase/functions/send-due-notifications/index.ts`

Também fazer redeploy do frontend para atualizar o Service Worker.

Nenhum SQL novo.
Nenhuma variável de ambiente nova.
