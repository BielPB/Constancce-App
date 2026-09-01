# CONSTANCCE — DIETA COM BASE ALIMENTAR + NUTRITION INTELLIGENCE PRO

Base:
CONSTANCCE-SEM-TASK-INTELLIGENCE.zip

## Nova arquitetura da Dieta
A seção agora possui:
1. Hoje
2. Alimentos
3. Insights

## Free — permanece útil e simples
O plano Free recebe:
- base alimentar Constancce com 49 alimentos comuns;
- busca por nome e aliases em português;
- cálculo automático por quantidade;
- medidas comuns como unidade, fatia, colher, xícara, scoop e porção;
- alimentos recentes;
- até 5 favoritos;
- até 2 refeições salvas;
- até 8 alimentos personalizados;
- repetir alimentação de ontem;
- registro diário de calorias e macros;
- histórico antigo continua preservado.

Nenhum alimento existente é apagado se o usuário ultrapassar futuramente um limite Free.

## PRO
O PRO acrescenta:
- busca de produtos industrializados online;
- Open Food Facts via backend;
- consulta por código de barras;
- scanner de código de barras quando o navegador suporta BarcodeDetector;
- mais favoritos e recentes;
- refeições salvas ampliadas;
- TMB;
- metas nutricionais personalizadas;
- fibras, sódio e açúcares;
- Nutrition Intelligence.

## Base alimentar
A base local inclui alimentos como:
- arroz;
- feijão;
- frango;
- carnes;
- ovos;
- peixes;
- batatas;
- macaxeira;
- cuscuz;
- tapioca;
- pão;
- aveia;
- frutas;
- leite/iogurte;
- queijos;
- castanhas;
- legumes;
- azeite;
- café;
- whey genérico.

Os valores da base local são referências nutricionais aproximadas para facilitar o registro.

## Busca online
Foi criada:
`supabase/functions/food-search/index.ts`

A função:
- exige usuário autenticado (`verify_jwt = true`);
- busca produtos por texto usando a busca full-text do Open Food Facts;
- consulta código de barras pela API de produto;
- normaliza calorias, proteína, carboidratos, gorduras, fibras, sódio e açúcares;
- devolve os dados em formato compatível com o Constancce.

Nenhuma nova chave de API é necessária para essa integração.

## Favoritos e recentes
Armazenados dentro do perfil sincronizado:
- `dietFavorites`
- `dietRecentFoods`

## Refeições salvas
Armazenadas em:
- `dietSavedMeals`

É possível salvar, por exemplo, um café da manhã completo e adicioná-lo novamente com um toque.

## Nutrition Intelligence PRO
Perguntas:
- Quanto de proteína consumi esta semana?
- Qual refeição tem mais calorias?
- Qual minha média calórica?
- Quantos dias bati meus macros?
- Qual alimento mais consumo?

Também gera leituras automáticas dos últimos 7 dias.

## Deploy
Frontend:
- redeploy normal.

Supabase:
- implantar a nova função `food-search`.

Config:
`[functions.food-search]`
`verify_jwt = true`

Nenhum SQL novo.
Nenhuma variável de ambiente nova.

## Validação
- App.jsx passou no parser TypeScript/JSX.
- Edge Function passou por verificações estruturais locais.
- Não foi executado build completo do Vite.
