# CONSTANCCE — TAREFAS INTELIGENTES + TASK INTELLIGENCE PRO

Base:
CONSTANCCE-FINANCAS-FILTRO-DATA-CORRECOES.zip

## Finanças
Nos botões principais do cabeçalho:
- "+ Entrada" virou "Entrada"
- "+ Saída" virou "Saída"

Os ícones foram mantidos.

## Nova estrutura de Tarefas
A seção foi organizada em:
1. Hoje
2. Quadro
3. Planejamento

## Hoje
- progresso do dia;
- total de tarefas pendentes;
- quantidade de tarefas prioritárias;
- quantidade de atrasadas;
- tempo total estimado;
- Próxima tarefa com botão Iniciar;
- Prioridade Constancce;
- divisão entre Prioridade e Depois;
- tarefas concluídas do dia;
- bloco de atenção para tarefas atrasadas;
- reagendamento rápido para Hoje, Amanhã ou data personalizada.

## Criação rápida
Ao criar uma tarefa, ficam visíveis primeiro:
- título;
- Hoje / Amanhã / Sem data;
- prioridade;
- tempo estimado.

O botão "Mais opções" abre:
- descrição;
- categoria;
- data específica;
- horário;
- lembrete;
- subtarefas;
- recorrência.

## Adiar
Tarefas podem ser adiadas rapidamente para:
- Hoje;
- Amanhã;
- +7 dias.

O Constancce registra a quantidade de adiamentos em `deferCount`.

## Subtarefas
- continuam clicáveis diretamente nos cards;
- não concluem automaticamente a tarefa principal;
- agora possuem barra de progresso visual.

## Planejamento
- planejamento semanal;
- tarefas sem data;
- tarefas recorrentes;
- tarefas futuras;
- arrastar tarefa para outro dia no desktop;
- escolha rápida de data no celular.

## Prioridade Constancce
Sistema determinístico que considera:
- prioridade;
- prazo;
- atraso;
- horário;
- subtarefas pendentes;
- quantidade de adiamentos.

Ele não usa IA externa e não inventa informações.

## Modo foco
Foi integrado às novas informações:
- prioridade;
- horário;
- tempo estimado;
- data;
- progresso de subtarefas;
- Pomodoro;
- conclusão da tarefa.

## Task Intelligence — PRO
Inclui:
- taxa de conclusão dos últimos 30 dias;
- melhor dia da semana;
- quantidade de tarefas adiadas repetidamente;
- tarefas atrasadas;
- tarefa mais adiada;
- tarefas concluídas na semana.

Perguntas reconhecidas:
- "Quantas tarefas concluí esta semana?"
- "Qual meu melhor dia?"
- "Qual tarefa estou adiando mais?"
- "Como foi meu mês?"
- perguntas sobre atrasos e taxa de conclusão.

## Visual
A seção recebeu:
- cards com hierarquia mais clara;
- gradientes discretos;
- detalhes tecnológicos;
- bordas e destaques por prioridade;
- interface compacta;
- responsividade para celulares;
- tabs sticky no mobile;
- formulários e selects preparados para toque/iOS.

## Preservado
- Financial Intelligence;
- filtro de data de Finanças;
- Treinos Inteligentes;
- Training Intelligence;
- subtarefas;
- descrição das tarefas;
- Kanban;
- histórico/sincronização;
- Supabase;
- PWA;
- notificações;
- Mercado Pago;
- regras Free/PRO;
- Perfil como última seção;
- Jornada e Desafios continuam removidos;
- Google Calendar continua fora do produto.

## Infraestrutura
Nenhum SQL novo.
Nenhuma Edge Function nova.
Nenhuma variável de ambiente nova.

## Validação
O `App.jsx` passou pelo parser TypeScript/JSX (`tsc`) sem erros de sintaxe em uma cópia limpa sem dependências implícitas.

Não foi executado um build completo do Vite nesta atualização.
