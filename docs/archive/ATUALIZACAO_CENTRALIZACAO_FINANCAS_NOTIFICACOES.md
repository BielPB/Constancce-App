# CONSTANCCE — CENTRALIZAÇÃO, FINANÇAS MOBILE E NOTIFICAÇÕES

Base:
CONSTANCCE-RESPONSIVIDADE-PLANEJAMENTO-PRO.zip

## 1. Sidebar
Foram centralizados:
- logo + nome Constancce;
- e-mail do usuário;
- card PRO Founder · Vitalício.

O card permanece entre o e-mail e o botão Buscar.

## 2. Finanças → Lançamentos no mobile
Nome e valor agora ficam anexados horizontalmente na mesma linha visual.

Ajustes:
- descrição ocupa a área flexível à esquerda;
- valor fica fixo à direita;
- valor não quebra linha;
- descrição usa ellipsis apenas quando a largura do celular for realmente insuficiente;
- categoria/status permanecem abaixo da descrição;
- ações Duplicar/Excluir continuam disponíveis;
- layout adaptado também para telas abaixo de 380px.

## 3. Notificações
Os títulos Web Push passam a seguir o padrão:
`Constancce - <tipo da notificação>`

Para tarefas:
- Constancce - Tarefa pendente
- Constancce - Tarefa pendente · em 15 min
- Constancce - Tarefa pendente · agora
- Constancce - Tarefa pendente · adiada
- Constancce - Tarefa pendente · atrasada

Também foi atualizado:
- Service Worker;
- Edge Function `send-due-notifications`;
- notificação de confirmação de ativação;
- cache do Service Worker para `constancce-shell-v7`.

Observação:
Navegadores/sistemas operacionais podem exibir uma linha separada identificando o site/app que enviou a notificação. Essa identificação pertence à interface do sistema. O título controlado pelo Constancce agora está no padrão solicitado.

## Deploy
Frontend:
- fazer redeploy normalmente.

Supabase:
- reimplantar `supabase/functions/send-due-notifications/index.ts`.

Nenhum SQL novo.
Nenhuma variável de ambiente nova.

## Preservado
- Responsividade do Quadro;
- Planejamento com frases completas;
- Histórico financeiro tecnológico;
- Metas inteligentes;
- Goal Intelligence;
- Calendar Intelligence;
- Task Intelligence;
- Training Intelligence;
- Financial Intelligence;
- Histórico de Treinos por período;
- Supabase/local sync;
- Mercado Pago;
- PWA;
- Free/PRO;
- Google Calendar continua fora do produto.

## Validação
O `App.jsx` passou pelo parser TypeScript/JSX (`tsc`) sem erros de sintaxe.
As alterações de Service Worker e Edge Function passaram por verificações estáticas.

Não foi executado um build completo do Vite nesta atualização.
