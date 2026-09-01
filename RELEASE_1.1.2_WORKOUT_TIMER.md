# Constancce 1.1.2 — Descanso persistente em Treinos

## Correções
- Descanso passou a usar horário final (`endAt`) em vez de decremento local.
- Continua correto ao trocar de aba, deixar o navegador em segundo plano ou bloquear a tela.
- Timer ativo fica visível globalmente fora da aba Treinos.
- Ao terminar, o Constancce abre um popup de “Descanso finalizado”.
- Clicar no timer global leva de volta à sessão de treino em andamento.
- Fechar o modal do treino não cancela mais o descanso.
- Campo de carga usa rascunho local e só salva ao sair do campo/pressionar Enter.
- Modal não reinicia mais o focus trap a cada re-render.
- É possível editar cargas normalmente enquanto o descanso está contando.

Nenhum SQL ou Edge Function foi alterado nesta versão.
