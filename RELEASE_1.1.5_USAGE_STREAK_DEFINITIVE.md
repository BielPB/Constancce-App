# Constancce 1.1.5 — Usage Streak definitivo

- Migração v3 descarta os dias inferidos pelas versões anteriores.
- Histórico antigo é reconstruído com a mesma lógica de score/atividade da aba Progresso.
- Nenhuma data anterior à criação real da conta pode entrar no streak.
- O dia atual entra imediatamente porque o app foi aberto.
- Depois da migração v3, cada novo dia é registrado diretamente em appUsageDays.
- O streak de hábitos continua separado.

Nenhum SQL ou Edge Function precisa ser alterado.
