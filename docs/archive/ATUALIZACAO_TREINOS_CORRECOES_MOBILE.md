# CONSTANCCE — CORREÇÕES MOBILE EM TREINOS

Base:
CONSTANCCE-TREINOS-HISTORICO-POR-PERIODO.zip

## Correção 1 — Campo de carga sem autozoom no mobile
O campo "Carga atual" foi ajustado para:
- usar tamanho efetivo de fonte de 16px no mobile;
- evitar o autozoom do iOS ao focar o campo;
- abrir teclado numérico/decimal de forma mais adequada;
- manter altura confortável para toque.

Também foi removida a dependência da classe `text-sm` nesse input, pois ela reduzia o tamanho real da fonte abaixo de 16px no mobile e podia provocar zoom automático no iPhone.

## Correção 2 — Cronômetro/resumo sem sobrepor o título
O resumo sticky do treino foi reposicionado para ficar abaixo do cabeçalho do modal.

Agora:
- título do treino permanece em camada superior;
- cronômetro/resumo permanece sticky sem entrar por baixo do título;
- foi adicionado espaçamento/offset correto no desktop e no mobile;
- blur e sombra foram refinados para separar visualmente as duas áreas.

## Preservado
- Histórico de treinos por período;
- filtros 7d/30d/90d/ano/tudo/personalizado;
- Training Intelligence;
- Goal Intelligence;
- Calendar Intelligence;
- Task Intelligence;
- Financial Intelligence;
- correção global de overscroll;
- retorno ao topo ao trocar de seção;
- Supabase/local sync;
- Mercado Pago;
- PWA/notificações;
- regras Free/PRO;
- Google Calendar continua fora do produto.

## Infraestrutura
Nenhum SQL novo.
Nenhuma Edge Function nova.
Nenhuma variável de ambiente nova.

## Validação
O `App.jsx` passou pelo parser TypeScript/JSX (`tsc`) sem erros de sintaxe.
Foram executadas verificações estáticas das duas correções e das funções críticas preservadas.

Não foi executado um build completo do Vite nesta atualização.
