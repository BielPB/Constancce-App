# CONSTANCCE — DAILY + INTELLIGENCE + SOCIAL + PRO

Esta versão consolida as melhorias solicitadas em uma única atualização.

## Hoje
- Central diária com score, streak, atividades, treino programado e finanças.
- Agenda de tarefas ordenada por horário.
- Hábitos pendentes.
- Próxima conta e meta em foco.
- Revisão automática dos últimos 7 dias.
- Campo para definir o foco da próxima semana.

## Tarefas
- Lembrete configurável: no horário, 5, 15, 30 ou 60 minutos antes.
- Subtarefas.
- Modo Foco com Pomodoro.
- Visão Kanban preservada.
- Nova visão "Minha semana" com drag-and-drop no desktop e seletor no mobile.
- Notificações com ações Concluir e Adiar 15 min.

## Treinos
- Programação por dias da semana.
- Treino recomendado automaticamente no dia correto.
- Registro de carga por exercício.
- Consulta da última carga.
- Gráfico de progressão de carga.
- Editar, copiar e organizar treinos preservados.

## Metas
- Marcos/checkpoints em 25%, 50%, 75% e 100%.
- XP adicional por marcos alcançados.
- Metas financeiras acumulativas preservadas.
- Integração direta com Finanças.

## Finanças
- Aporte para meta: registra a saída e soma automaticamente na meta escolhida.
- Contas a pagar com vencimento e status.
- Contas futuras entram na previsão do fechamento.
- Recorrências, orçamento, saúde financeira e previsão preservados.

## Progresso / Conquistas
- XP histórico separado do Score atual.
- Desafios pessoais.
- Desafio entre amigos usando XP, Score ou Streak.
- Jornada/Timeline de evolução.
- Conquistas, raridades, recordes e insights preservados.

## Navegação e produtividade
- Busca global.
- Central de Comandos com Cmd+K / Ctrl+K.
- Módulos personalizáveis no Perfil.
- Onboarding cria uma configuração inicial conforme as áreas escolhidas.

## PWA e segurança de dados
- Cache offline do shell do app.
- Atalhos PWA para Hoje, Tarefas e Finanças.
- Instalação do app pelo Perfil quando suportada.
- Sincronização manual.
- Até 3 pontos locais de recuperação diária.
- Backup manual preservado.

## Conta
- Alterar e-mail.
- Alterar senha.
- Enviar recuperação de senha.
- Exclusão de conta via Edge Function `delete-account`.

## Correção textual
- "Meses" foi corrigido para "Meses".

## IMPORTANTE — SUPABASE
Não há novo SQL obrigatório nesta atualização.

Para ativar todas as funções da versão:
1. Reimplante `send-due-notifications`, pois ele agora possui lembretes por horário, ações de tarefa, revisão semanal e alertas de contas.
2. Implante a nova Edge Function `delete-account` para habilitar o botão "Excluir conta".

As secrets existentes de notificações continuam as mesmas.
O Cron existente de 15 minutos continua válido.
