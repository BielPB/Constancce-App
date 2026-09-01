# CONSTANCCE — CALENDÁRIO INTELIGENTE + CORREÇÕES MOBILE

Base:
CONSTANCCE-TAREFAS-INTELIGENTES-PRO.zip

## Calendário
A seção agora foi organizada em:
1. Hoje
2. Semana
3. Mês

## Integração automática
O Calendário lê e organiza dados já existentes do Constancce:
- tarefas;
- treinos programados/concluídos;
- contas a pagar;
- hábitos;
- metas com prazo/conclusão.

Não é necessário cadastrar o mesmo item duas vezes.

## Hoje
- resumo do dia;
- tarefas, treinos e contas;
- progresso das tarefas;
- tempo estimado planejado;
- próxima ação;
- conflitos de horário;
- agenda detalhada.

## Semana
- 7 dias em uma visão compacta;
- quantidade de itens;
- progresso de tarefas;
- tempo estimado;
- marcadores visuais;
- tarefas visíveis no desktop;
- arrastar tarefa para outro dia no desktop.

## Mês
- grade mensal;
- marcadores de tarefas, treinos, finanças, hábitos e metas;
- indicador +N quando há muitos itens;
- resumo mensal de tarefas, treinos e contas;
- tocar no dia abre o painel detalhado.

## Filtros
- Tudo
- Tarefas
- Treinos
- Finanças
- Hábitos
- Metas

## Criação rápida pelo calendário
Em qualquer dia:
- criar tarefa já na data;
- programar treino já na data;
- cadastrar conta já com o vencimento da data.

## Reagendamento
- desktop: drag-and-drop para outro dia;
- mobile: botão Reagendar com Hoje, Amanhã ou data personalizada.

## Treinos programados
Foi adicionada a estrutura `plannedOnly` às sessões programadas pelo Calendário.
Ela permite:
- programar uma sessão futura;
- mostrar o treino no Calendário;
- não poluir o histórico de treino como se tivesse sido iniciado;
- transformar o agendamento em sessão normal quando o usuário iniciar o treino na data.

## Calendar Intelligence — PRO
Leituras determinísticas com dados internos:
- dia mais carregado;
- dia mais livre;
- tarefas de amanhã;
- contas vencendo na semana;
- tarefas atrasadas;
- conflitos de horário;
- treinos em dias consecutivos;
- carga visual da semana.

Perguntas disponíveis:
- Qual meu dia mais cheio?
- Quantas tarefas tenho amanhã?
- Tenho alguma conta vencendo esta semana?
- Qual dia está mais livre?

Nenhuma IA externa foi adicionada.

## Correção global de overscroll em cadastros
O componente Modal foi atualizado:
- trava o scroll do conteúdo atrás do cadastro;
- impede scroll chaining/overscroll;
- utiliza `100dvh` no mobile;
- respeita safe areas;
- mantém apenas o conteúdo do cadastro rolável;
- evita que tarefa, treino, meta, finanças e demais modais ultrapassem a tela de forma anormal.

## Troca de seção
Ao entrar em uma nova aba/seção:
- o scroll da página volta para o topo;
- o scroll interno do desktop também volta para o topo;
- o comportamento funciona para navegação lateral, menu mobile e swipe entre seções.

## Responsividade
- tabs compactas no celular;
- painel semanal vira uma coluna no mobile;
- grade mensal compacta;
- botões adequados para toque;
- inputs de data em 16px no iOS;
- Calendar Intelligence adaptado para telas pequenas;
- modais adaptados a viewport dinâmica.

## Preservado
- Financial Intelligence;
- filtro por data em Finanças;
- botões Entrada e Saída sem sinais;
- Task Intelligence;
- Treinos Inteligentes;
- Training Intelligence;
- sincronização local + Supabase;
- Free/PRO;
- Mercado Pago;
- notificações;
- PWA;
- Perfil como última seção;
- Jornada e Desafios continuam removidos;
- Google Calendar continua fora do produto.

## Infraestrutura
Nenhum SQL novo.
Nenhuma Edge Function nova.
Nenhuma variável de ambiente nova.

## Validação
O `App.jsx` passou pelo parser TypeScript/JSX (`tsc`) sem erros de sintaxe.
Também foram executadas validações estáticas das integrações e dos recursos descritos acima.

Não foi executado um build completo do Vite nesta atualização.
