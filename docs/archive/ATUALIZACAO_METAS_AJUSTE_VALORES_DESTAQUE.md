# CONSTANCCE — AJUSTE DE VALORES EM METAS + DESTAQUE

Base:
CONSTANCCE-TREINOS-CORRECOES-MOBILE.zip

## 1. Destaque alinhado com a estrela
O selo de destaque das metas foi refinado:
- estrela e texto permanecem na mesma linha;
- sem quebra entre ícone e palavra;
- no card em destaque o texto passa a aparecer como "Destaque";
- Meta principal continua identificada normalmente.

## 2. Adicionar e remover progresso
A área de progresso das metas agora possui dois modos:
- Adicionar
- Remover

### Valores rápidos
Metas financeiras:
- R$ 50
- R$ 100
- R$ 500
- Outro

Metas numéricas:
- 1
- 5
- 10
- Outro

Os mesmos valores podem ser utilizados para adicionar ou remover progresso.

### Valor personalizado
O usuário pode digitar:
- valor a adicionar;
- valor a remover.

A remoção nunca permite que o progresso fique abaixo de zero.

## 3. Confirmação antes da alteração
Antes de adicionar ou remover qualquer valor, é exibido um popup de confirmação.

O popup mostra:
- ação que será realizada;
- valor;
- nome da meta;
- progresso atual;
- progresso após a confirmação;
- Cancelar;
- Confirmar adição / Confirmar remoção.

Se o usuário tentar remover um valor maior que o progresso atual:
- o app informa isso;
- limita a remoção ao total atualmente registrado;
- nunca gera saldo negativo.

## 4. Histórico
O histórico da meta agora registra:
- + para valores adicionados;
- − para valores removidos;
- tipo do ajuste;
- novo saldo da meta.

Remoções não disparam celebrações de marco.
Adições continuam celebrando marcos quando aplicável.

## Preservado
- Histórico de Treinos por período;
- correções mobile dos campos de carga;
- correção do cronômetro/resumo sticky;
- Goal Intelligence;
- Calendar Intelligence;
- Task Intelligence;
- Training Intelligence;
- Financial Intelligence;
- Supabase/local sync;
- Free/PRO;
- Mercado Pago;
- notificações e PWA;
- correção de overscroll;
- retorno ao topo ao trocar de seção;
- Google Calendar continua fora do produto.

## Infraestrutura
Nenhum SQL novo.
Nenhuma Edge Function nova.
Nenhuma variável de ambiente nova.

## Validação
O App.jsx passou pelo parser TypeScript/JSX (`tsc`) sem erros de sintaxe.
Também foram realizadas verificações estáticas dos recursos alterados e das funções críticas preservadas.

Não foi executado um build completo do Vite nesta atualização.
