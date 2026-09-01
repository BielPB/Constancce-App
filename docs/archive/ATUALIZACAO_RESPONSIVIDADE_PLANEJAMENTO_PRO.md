# CONSTANCCE — RESPONSIVIDADE, PLANEJAMENTO E PRO

Base:
CONSTANCCE-REFINO-UI-MOBILE-HISTORICOS.zip

## 1. Tarefas → Quadro
A área de Tarefas ganhou largura maior no desktop.

Responsividade do Quadro:
- desktop amplo: 5 colunas visíveis;
- larguras intermediárias: 2 colunas por linha;
- mobile: 1 coluna;
- sem coluna cortada pela lateral;
- cards continuam com min-width seguro e conteúdo responsivo.

## 2. Tarefas → Planejamento
Os cards da semana deixaram de truncar o título.

Agora:
- o nome da tarefa aparece completo;
- não existe mais `...` no título do planejamento;
- textos podem quebrar em múltiplas linhas;
- horário, prioridade e subtarefas permanecem organizados;
- a grade de 7 dias continua responsiva.

## 3. Sidebar / plano do usuário
Foi removido da sidebar:
- texto "Salvo";
- bolinha de status.

Entre o e-mail e o campo Buscar agora fica somente o card do plano.

Para Founder vitalício:
- texto exibido: `PRO Founder · Vitalício`;
- card centralizado horizontalmente;
- ícone de troféu preservado.

O status de sincronização continua funcionando internamente e continua disponível na área apropriada do Perfil/Conta.

## 4. Card PRO
Para usuário Free/Básico:
- botão `Atualizar para PRO`;
- centralizado dentro do card PRO;
- mantém o fluxo existente de upgrade/checkout.

Para usuário PRO Founder:
- indicador `Founder vitalício ativo` centralizado.

## Preservado
- Metas com adicionar/remover valor e confirmação;
- Goal Intelligence;
- Histórico de Treinos por período;
- correções de zoom e cronômetro em Treinos;
- Histórico financeiro tecnológico;
- Calendar Intelligence;
- Task Intelligence;
- Training Intelligence;
- Financial Intelligence;
- menu Mais marcando a seção atual;
- Supabase/local sync;
- Mercado Pago;
- notificações;
- PWA;
- Free/PRO;
- Google Calendar continua fora do produto.

## Infraestrutura
Nenhum SQL novo.
Nenhuma Edge Function nova.
Nenhuma variável de ambiente nova.

## Validação
O `App.jsx` passou pelo parser TypeScript/JSX (`tsc`) sem erros de sintaxe.
Foram realizadas verificações estáticas dos novos comportamentos e das funções críticas preservadas.

Não foi executado um build completo do Vite nesta atualização.
