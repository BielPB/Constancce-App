# CONSTANCCE — REFINO DE UI, ZOOM MOBILE E HISTÓRICOS

Base:
CONSTANCCE-METAS-AJUSTE-VALORES-DESTAQUE.zip

## 1. Espaçamento superior em todas as seções
No mobile, a área principal agora possui espaçamento consistente entre o topo da tela e o título de cada seção.

Foi aplicado:
- padding superior global na área principal;
- respeito ao `safe-area-inset-top` em iPhones/PWA;
- todas as seções herdam o mesmo comportamento, sem precisar corrigir tela por tela.

No desktop/tablet, o espaçamento existente foi preservado.

## 2. Zoom na aba Treinos
O comportamento de zoom em campos foi corrigido sem bloquear a acessibilidade do navegador.

Alterações:
- viewport declara explicitamente `user-scalable=yes`;
- zoom máximo permitido até 5x;
- modal não restringe mais gestos de pinça;
- inputs/selects/textareas usam `touch-action:auto`;
- botões continuam usando `touch-action:manipulation`;
- campos do modo treino ficam em 16px para evitar o autozoom involuntário do iOS;
- campo de carga também permite gestos nativos de zoom.

Resultado esperado:
- tocar em campo não gera autozoom indesejado;
- o usuário pode ampliar/reduzir novamente com pinça;
- o navegador mantém o comportamento nativo de zoom/double tap quando suportado pelo dispositivo.

## 3. Finanças — histórico financeiro mais tecnológico
O histórico no fim da área de lançamentos foi redesenhado.

Agora possui:
- cabeçalho "Histórico financeiro";
- resumo de quantidade de registros + mês;
- linha temporal vertical;
- indicador visual diferente para Entrada/Saída;
- bloco compacto de dia/mês;
- badges Pago e Recorrente;
- valor destacado;
- data secundária;
- ações de duplicar/excluir preservadas;
- primeiro item recebe destaque discreto;
- responsivo em mobile e desktop.

Nenhuma movimentação foi alterada ou migrada.

## 4. Tarefas — card dos 7 dias sem quebra
Dentro de Tarefas → Planejamento → Minha semana:
- cada card de tarefa é exibido em uma única linha;
- horário, título, prioridade e subtarefas ficam alinhados;
- título usa ellipsis quando faltar espaço;
- nenhum desses cards cresce verticalmente por quebra do conteúdo;
- chip "7 dias" também permanece sem quebra.

## 5. Calendário — datas passadas
No Resumo do dia:
- botão "Adicionar" aparece apenas para hoje ou datas futuras;
- ao selecionar uma data anterior a hoje, o botão não é exibido;
- histórico do dia continua visível normalmente.

## 6. Menu mobile — três pontinhos / Mais
Ao abrir "Mais":
- o card correspondente à seção atual fica marcado;
- borda/acento visual usa a cor principal;
- ícone e texto ficam destacados;
- pequeno indicador visual confirma a aba ativa;
- o botão "Mais" na barra inferior também fica ativo quando a seção atual pertence ao menu Mais.

## Preservado
- Metas: adicionar/remover valor com confirmação;
- Goal Intelligence;
- Histórico de Treinos por período;
- correções mobile do modo treino;
- Calendar Intelligence;
- Task Intelligence;
- Training Intelligence;
- Financial Intelligence;
- Supabase/local sync;
- regras Free/PRO;
- Mercado Pago;
- notificações;
- PWA;
- overscroll dos modais;
- retorno ao topo ao trocar de seção;
- Google Calendar continua fora do produto.

## Infraestrutura
Nenhum SQL novo.
Nenhuma Edge Function nova.
Nenhuma variável de ambiente nova.

## Validação
O `App.jsx` passou pelo parser TypeScript/JSX (`tsc`) sem erros de sintaxe.
Também foram executadas verificações estáticas das alterações e das funcionalidades críticas preservadas.

Não foi executado um build completo do Vite nesta atualização.
