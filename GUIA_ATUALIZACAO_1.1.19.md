# Atualização 1.1.19 — passo a passo

## 1. Frontend

Suba o código completo da versão 1.1.19 na Vercel.

## 2. Edge Functions

Abra o CMD dentro da pasta extraída e execute:

```cmd
npx supabase functions deploy domain-sync --project-ref opuirvfoxrqfkvbihfbs --use-api
```

Depois:

```cmd
npx supabase functions deploy send-due-notifications --project-ref opuirvfoxrqfkvbihfbs --use-api
```

Confirme no Supabase > Edge Functions que as duas aparecem como atualizadas recentemente.

## 3. Cron das notificações

O `send-due-notifications` deve ser chamado a cada 5 minutos para melhorar a precisão do aviso de 30 minutos.

Troque a agenda atual:

```text
*/15 * * * *
```

por:

```text
*/5 * * * *
```

Mantenha:

- método `POST`;
- URL `https://SEU-PROJETO.supabase.co/functions/v1/send-due-notifications`;
- header `x-cron-secret: SEU_PUSH_CRON_SECRET`.

## 4. Secrets

Não há secret novo. Os já existentes continuam necessários:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`
- `PUSH_CRON_SECRET`

## 5. Teste

1. Ative notificações no Constancce.
2. Crie uma tarefa para aproximadamente 35–40 minutos no futuro.
3. Informe descrição, prioridade e categoria.
4. Aguarde a janela de 30 minutos.
5. A notificação deve mostrar o nome da tarefa e seus detalhes.

Em iPhone/iPad, teste pelo Constancce instalado na Tela de Início.

## 6. Sem SQL novo

Se `push_subscriptions` e `push_notification_log` já existem, não é necessário executar SQL adicional.
