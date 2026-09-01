# CONSTANCCE — HISTÓRICO DE TREINOS POR PERÍODO

Base:
CONSTANCCE-METAS-INTELIGENTES-PRO.zip

## Alteração em Treinos → Evolução → Histórico de treinos

Foi adicionado um filtro por período para facilitar a consulta dos treinos já registrados.

### Períodos disponíveis
- Últimos 7 dias
- Últimos 30 dias
- Últimos 90 dias
- Este ano
- Todo o histórico
- Personalizado

### Intervalo personalizado
No modo Personalizado, o usuário pode selecionar:
- data inicial;
- data final.

O histórico é atualizado imediatamente conforme o período escolhido.

### Resumo do período
O filtro mostra:
- quantidade de treinos concluídos;
- volume total registrado no período;
- tempo total de treino registrado no período.

### Plano Free
A regra existente foi preservada:
- histórico detalhado limitado aos últimos 30 dias;
- 7 dias, 30 dias e período personalizado dentro dos 30 dias continuam disponíveis;
- 90 dias, Este ano e Tudo direcionam para o PRO;
- nenhum dado antigo é apagado.

### Plano PRO
- acesso aos 90 dias;
- ano atual;
- todo o histórico;
- intervalo personalizado sem o limite Free.

## UX
- filtro localizado dentro do próprio Histórico de treinos;
- presets em botões horizontais;
- período selecionado destacado;
- estado vazio específico quando não há treino no intervalo escolhido;
- responsividade para celulares;
- inputs de data com tamanho adequado para iOS.

## Preservado
- Hoje / Meus treinos / Evolução;
- Training Intelligence;
- progressão de carga;
- recordes;
- histórico original;
- Goal Intelligence;
- Calendar Intelligence;
- Task Intelligence;
- Financial Intelligence;
- sincronização Supabase/local;
- correção de overscroll;
- retorno ao topo ao trocar de seção;
- Mercado Pago;
- PWA e notificações;
- regras Free/PRO;
- Google Calendar continua fora do produto.

## Infraestrutura
Nenhum SQL novo.
Nenhuma Edge Function nova.
Nenhuma variável de ambiente nova.

## Validação
O App.jsx passou pelo parser TypeScript/JSX (`tsc`) sem erros de sintaxe.
Foram realizadas verificações estáticas dos recursos adicionados e das funcionalidades críticas preservadas.

Não foi executado um build completo do Vite nesta atualização.
