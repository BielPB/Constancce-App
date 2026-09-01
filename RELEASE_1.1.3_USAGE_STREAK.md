# Constancce 1.1.3 — Foguinho de uso diário

## Correção principal
- O foguinho da tela Hoje não depende mais da conclusão de todos os hábitos.
- Cada dia em que o usuário abre o Constancce é registrado em `profile.appUsageDays`.
- O streak atual conta dias consecutivos de presença no app.
- Recorde e total de dias ativos também são armazenados/calculados.
- Na primeira abertura da versão 1.1.3, o app tenta recuperar até 45 dias recentes a partir de sinais reais já registrados (hábitos concluídos, tarefas criadas/concluídas, treinos, refeições, progresso de metas etc.).
- O streak antigo de hábitos permanece intacto para XP, estatísticas, conquistas e evolução.

Nenhum SQL ou Edge Function novo é necessário.
