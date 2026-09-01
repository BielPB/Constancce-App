# CONSTANCCE — CONFIABILIDADE, TREINOS, CALENDÁRIO, MENU E NOTIFICAÇÕES

## 1. Salvamento reforçado
A sincronização foi fortalecida para reduzir drasticamente risco de regressão de estado:
- cada versão recebe __syncUpdatedAt;
- cache local é comparado à versão remota no login;
- uma versão remota mais antiga não sobrescreve automaticamente dados locais mais novos;
- persist() grava localmente e coloca o mesmo payload na fila remota imediatamente;
- tentativa extra de sync ao ocultar/fechar a página usando keepalive;
- conclusão de treino grava completed=true e completedAt;
- toast confirma "Treino concluído e salvo".

## 2. Mobile
- espaço superior externo praticamente removido;
- conteúdo fica mais próximo das bordas úteis da tela;
- navegação inferior continua protegida para não cobrir conteúdo.

## 3. Hoje
- removido o campo "O que você quer melhorar nos próximos 7 dias?";
- permanecem apenas os dados da revisão semanal.

## 4. Treinos concluídos
- treino feito: CTA "Visualizar treino feito";
- modal de treino concluído não oferece concluir novamente;
- chip "hoje ✓" não quebra em duas linhas.

## 5. Histórico de treinos
Histórico redesenhado com:
- status Concluído / Em andamento;
- data;
- séries realizadas;
- barra de progresso;
- maior carga registrada;
- visual em cards responsivos.

## 6. Notificações horárias
Novo resumo entre 08:00 e 22:00.
É enviado no máximo uma vez por hora, quando houver pendência, podendo incluir:
- tarefas;
- treino programado;
- hábitos;
- dieta cadastrada;
- contas próximas/atrasadas.

O Cron existente de 15 minutos continua válido.
É necessário apenas reimplantar send-due-notifications.

## 7. Menu personalizável
No Perfil > Ordem do menu:
- usuário move seções para cima/baixo;
- primeiras 5 seções visíveis viram o menu principal mobile;
- demais ficam em Mais;
- swipe horizontal respeita exatamente essa nova ordem;
- existe botão Restaurar ordem padrão.

A ordem padrão continua:
Hoje → Treinos → Hábitos → Finanças → Perfil → demais seções.

## 8. Calendário
Redesenhado com:
- resumo mensal;
- tarefas concluídas;
- treinos concluídos;
- dias completos;
- indicadores de tarefa, treino e meta no calendário;
- botão Ir para hoje;
- agenda detalhada do dia;
- cards separados de tarefas, hábitos, treino e metas.

## 9. Metas
Mantidos e verificados:
- foto por meta;
- arquivar metas concluídas;
- restaurar metas arquivadas.

## 10. Conquistas
Ao tocar em Comum, Rara, Épico ou Lendário:
- abre detalhes do prêmio;
- mostra requisito;
- progresso;
- dias restantes;
- área preparada para foto do produto.
A foto permanece propositalmente vazia nesta versão.

## Deploy
Não há SQL novo.

SUPABASE:
Reimplante:
supabase/functions/send-due-notifications/index.ts

O Cron existente a cada 15 minutos não precisa ser alterado.
