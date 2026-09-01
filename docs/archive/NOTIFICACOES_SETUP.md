# CONSTANCCE — CONFIGURAÇÃO DAS NOTIFICAÇÕES

Esta versão NÃO possui integração com Google Agenda.

Incluído:

- pedido de permissão de notificações;
- notificações Web Push no celular/computador;
- ativar/desativar por dispositivo;
- preferências por categoria;
- Service Worker;
- lembretes em background mesmo com o app fechado;
- abertura automática da aba correta ao clicar em uma notificação.

## 1. Supabase SQL

Execute:

`SUPABASE_NOTIFICACOES_SETUP.sql`

Se você já executou anteriormente o arquivo que criava Google Agenda + notificações,
as tabelas push provavelmente já existem. O SQL utiliza `if not exists`, portanto
pode ser executado novamente com segurança.

Como você decidiu NÃO utilizar Google Agenda, também deixei:

`SUPABASE_REMOVER_GOOGLE_AGENDA.sql`

Esse segundo arquivo é opcional, mas recomendado para remover as tabelas do Google
que foram criadas anteriormente.

## 2. Publicar Edge Functions

Publique:

- `push-subscription`
- `send-due-notifications`

JWT:

- `push-subscription` → Verify JWT ON
- `send-due-notifications` → Verify JWT OFF

A segunda função é protegida por um secret próprio do Cron.

## 3. Criar chaves VAPID

No terminal do Mac/PC com Node instalado:

`npx web-push generate-vapid-keys`

Guarde:

- Public Key
- Private Key

## 4. Supabase Edge Function Secrets

Crie:

`VAPID_PUBLIC_KEY`
`VAPID_PRIVATE_KEY`
`VAPID_SUBJECT`
`PUSH_CRON_SECRET`

Exemplo de VAPID_SUBJECT:

`mailto:seuemail@dominio.com`

Para gerar o PUSH_CRON_SECRET no Mac:

`openssl rand -hex 32`

Nunca coloque VAPID_PRIVATE_KEY ou PUSH_CRON_SECRET no React/Vercel público.

## 5. Agendar o envio

A Edge Function `send-due-notifications` deve ser chamada a cada 15 minutos.

Cron:

`*/15 * * * *`

Método:

`POST`

URL:

`https://SEU-PROJETO.supabase.co/functions/v1/send-due-notifications`

Header:

`x-cron-secret: SEU_PUSH_CRON_SECRET`

## Lembretes configurados

Tarefas:
- pendências do dia a partir das 09h;
- tarefas atrasadas.

Treinos:
- lembrete a partir das 17h se ainda não houver treino concluído.

Hábitos:
- lembrete a partir das 18h caso existam hábitos pendentes.

Metas:
- aviso para metas que vencem em até 3 dias.

Finanças:
- aviso quando o limite mensal definido for ultrapassado.

O sistema registra os avisos enviados por dispositivo para evitar repetição.

## Celular

Android:
- Chrome/PWA suporta Web Push após a permissão.

iPhone/iPad:
- para Web Push, o ideal é adicionar o Constancce à Tela de Início e abrir o
  aplicativo instalado antes de permitir notificações.

## Segurança

- cada dispositivo fica associado ao user_id do Supabase;
- as inscrições push não são expostas pelo REST público;
- envio em background usa service_role somente no backend;
- `send-due-notifications` exige `PUSH_CRON_SECRET`;
- nenhuma integração Google está presente nesta versão.
