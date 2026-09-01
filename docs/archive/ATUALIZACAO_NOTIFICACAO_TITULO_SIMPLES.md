# CONSTANCCE — TÍTULO DE NOTIFICAÇÃO SIMPLIFICADO

Base:
CONSTANCCE-CENTRALIZACAO-FINANCAS-NOTIFICACOES.zip

Alteração:
- Antes: `Constancce - Seu próximo passo no Constancce`
- Agora: `Constancce - Seu próximo passo`

A Edge Function agora envia `Seu próximo passo` e o prefixo global adiciona `Constancce -`.

Observação:
A indicação separada `From Constancce`, quando exibida pelo navegador/sistema operacional,
é metadado da origem da notificação e não faz parte do título controlado pelo app.

Deploy:
Reimplantar apenas:
`supabase/functions/send-due-notifications/index.ts`

Nenhum SQL novo.
Nenhuma variável de ambiente nova.
