# CONSTANCCE — ROTINA INTELIGENTE: NOTIFICAÇÕES, STREAK, TREINOS, FINANÇAS E DIETA

Base:
`CONSTANCCE-DIETA-BASE-ALIMENTAR-PRO.zip`

## 1. Tarefas atrasadas — lembrete de 1 em 1 hora
A Edge Function `send-due-notifications` foi atualizada.

Para usuários PRO com notificações de tarefas ativas:
- uma tarefa com horário definido recebe o lembrete normal;
- se não for concluída/reagendada e já estiver pelo menos 1 hora atrasada, passa a receber lembretes a cada 1 hora;
- a cadência acompanha o minuto original da tarefa;
- exemplo: tarefa às 10:30 → lembretes por volta de 11:30, 12:30, 13:30 etc.;
- lembretes inteligentes continuam respeitando a janela 08:00–22:00;
- cada hora possui uma chave própria no log, evitando duplicidade dentro da mesma hora;
- tarefa adiada (`snoozedUntil`) não recebe o lembrete enquanto estiver adiada.

O plano Free mantém notificações básicas, preservando a diferenciação Free/PRO.

## 2. Foguinho/Streak na tela Hoje
Corrigida a regra do streak atual.

Antes:
- enquanto o dia de hoje ainda não estivesse completo, o streak podia aparecer como 0 mesmo com o dia anterior concluído.

Agora:
- se hoje já foi concluído, hoje entra no streak;
- se hoje ainda está em andamento, o streak vigente considera corretamente o último dia completo;
- dias sem hábito obrigatório de streak não quebram a sequência;
- o recorde e os dias perfeitos continuam sendo calculados normalmente.

## 3. Treinos — clicar no nome exibe exercícios
Em `Treinos → Meus treinos`:
- o nome do treino virou um controle expansível;
- tocar/clicar no nome abre os exercícios cadastrados;
- mostra ordem, nome, séries, repetições, carga e grupo muscular;
- tocar novamente recolhe a lista;
- iniciar/editar/copiar/compartilhar/excluir continuam funcionando normalmente.

## 4. Treinos → Evolução → Tempo do período
Corrigido o total de tempo do histórico.

A leitura agora usa, nesta ordem:
1. `durationMinutes` já salvo;
2. diferença real entre `startedAt` e `completedAt`;
3. para sessões antigas sem timestamps, estimativa conservadora baseada nas séries realizadas.

Isso permite que treinos antigos também contribuam para `Tempo` no período selecionado.

## 5. Finanças — confirmação antes de copiar
O botão de copiar lançamento não duplica mais imediatamente.

Agora aparece um modal mostrando:
- descrição/categoria;
- valor;
- explicação do que será copiado;
- Cancelar;
- Confirmar cópia.

Vínculos automáticos com conta recorrente, conta paga ou meta continuam sendo removidos da cópia, evitando duplicações indevidas.

## 6. Dieta — planejamento + consumo
A aba Dieta foi evoluída para separar o que está planejado do que realmente foi consumido.

### Checklist de consumo
Cada alimento registrado possui um check.
- novo alimento entra como `planejado`;
- ao marcar o check, passa para `Consumido`;
- ao desmarcar, volta para pendente;
- calorias e macros do dia consideram apenas itens consumidos;
- registros antigos sem o novo campo continuam sendo tratados como consumidos para compatibilidade.

### Visual mais sofisticado
Cada refeição agora possui um card próprio:
- Café da manhã;
- Almoço;
- Lanche;
- Jantar;
- Outro.

Cada card mostra:
- itens consumidos / itens planejados;
- calorias consumidas / planejadas;
- proteína consumida;
- barra de conclusão;
- alimento com kcal e macros;
- status `Consumido`;
- ações de editar e remover.

### Adicionar alimento em cada refeição
Cada card de refeição tem seu próprio botão `Adicionar`.
Ao adicionar por ali, o formulário já abre com a refeição correta selecionada.

### Editar alimento registrado
Novo modal `Editar alimento registrado`.
É possível alterar:
- refeição;
- nome;
- medida;
- quantidade;
- calorias/macros nos registros sem snapshot nutricional;
- nutrientes avançados continuam respeitando o PRO.

Para itens da Base Alimentar Constancce/produtos online, mudar medida ou quantidade recalcula automaticamente os nutrientes.

### Refeições salvas e repetir ontem
Ao reutilizar uma refeição salva ou repetir o dia anterior:
- os itens entram novamente como planejados;
- o usuário marca cada item conforme consumir.

### Nutrition Intelligence
Foi ajustada para analisar apenas alimentos efetivamente consumidos.

## Push e Dieta
O resumo de notificações considera apenas refeições marcadas como consumidas ao avaliar o andamento da dieta.

## Preservado
- Base Alimentar Constancce;
- `food-search` + Open Food Facts;
- código de barras PRO;
- favoritos/recentes/refeições salvas;
- Goal Intelligence;
- Calendar Intelligence;
- Training Intelligence;
- Financial Intelligence;
- Task Intelligence continua removido;
- histórico de treinos por período;
- notificações com título limpo;
- Supabase/local sync;
- Mercado Pago;
- PWA;
- regras Free/PRO;
- Google Calendar continua fora do produto.

## Deploy
Frontend:
- redeploy normal.

Supabase:
- reimplantar `supabase/functions/send-due-notifications/index.ts`.
- `food-search` continua igual à versão anterior; não precisa de nova configuração se já foi implantado.

Nenhum SQL novo.
Nenhuma variável de ambiente nova.

## Validação
- `App.jsx` passou no parser TypeScript/JSX (`tsc`) sem erros de sintaxe.
- foram realizadas verificações estáticas dos recursos alterados;
- a lógica de deduplicação horária das notificações foi preservada pelo `push_notification_log`;
- não foi executado build completo do Vite nesta atualização;
- Deno não está disponível no ambiente local para `deno check` completo da Edge Function.
