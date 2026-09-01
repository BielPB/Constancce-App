# CONSTANCCE — FINANCIAL INTELLIGENCE ENGINE

Base:
CONSTANCCE-PLANOS-MENU-PROGRESSO-REFINADO.zip

## O que mudou
O Assistente Financeiro deixou de depender de uma sequência simples de `if`.
Agora existe um motor interno de interpretação financeira.

### Pipeline
Pergunta
→ normalização
→ detecção de intenção
→ detecção de período
→ detecção de categoria / estabelecimento
→ detecção de meta
→ cálculo usando dados reais
→ resposta curta
→ memória de contexto

## Intenções suportadas
- total de gastos
- total de entradas
- saldo
- economia líquida
- maior categoria de gasto
- maior gasto/estabelecimento
- gasto por categoria
- gasto por estabelecimento
- comparação de gastos
- comparação de receitas
- quantidade de metas
- lista/resumo de metas
- progresso da meta
- valor restante da meta
- aporte mensal necessário
- projeção de atingir uma meta
- contas vencidas
- próximas contas
- total de contas pendentes
- orçamento disponível
- orçamento restante por categoria
- despesas recorrentes
- receitas recorrentes
- projeção de fechamento do mês
- diagnóstico de onde os gastos aumentaram
- diagnóstico de por que a sobra diminuiu

## Períodos entendidos
- hoje
- ontem
- anteontem
- esta semana
- semana passada
- últimos N dias
- este mês
- mês passado
- meses pelo nome, como "agosto" ou "julho de 2026"

## Contexto
O assistente mantém o contexto das últimas perguntas.

Exemplo:
"Quanto gastei este mês?"
"E mês passado?"

Ou:
"Como está a meta MacBook?"
"E quanto falta?"

## Segurança
A interpretação escolhe o que calcular.
Os valores financeiros NÃO são inventados pelo assistente.
Somas, comparações, percentuais e projeções usam os registros reais do Constancce.

Se a pergunta não puder ser interpretada com confiança:
"Não consigo te ajudar com essa pergunta no momento."

## Infraestrutura
Nenhum SQL novo.
Nenhuma Edge Function nova.
Nenhuma chave de IA/OpenAI é necessária nesta versão.

O motor funciona localmente usando os dados já sincronizados do usuário.
