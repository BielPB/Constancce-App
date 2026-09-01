# Constancce 1.1.6 — Base alimentar brasileira ampliada

## Base
- Mantém a base curada do Constancce com medidas caseiras.
- Adiciona carregamento da TACO 4ª edição (NEPA/UNICAMP), com 597 registros.
- O CSV é convertido para o schema interno da Dieta e armazenado em cache local por até 90 dias.
- Se a TACO estiver temporariamente indisponível, a base curada continua funcionando.
- Produtos industrializados via Open Food Facts continuam exclusivos do PRO.

## Busca
- Normalização de acentos, vírgulas, hífens e pontuação.
- Categoria passa a participar da busca.
- Sinônimos brasileiros adicionais.
- Ranking por correspondência exata, início do nome e aliases.
- Busca passa de 24 para até 48 resultados relevantes.

## Nutrientes
A TACO fornece energia, proteína, carboidratos, lipídios, fibra e sódio por 100 g.
Açúcares totais não constam da composição centesimal TACO e são marcados internamente como indisponíveis.

## Infra
- CSP autoriza somente `raw.githubusercontent.com` adicionalmente para baixar o CSV público.
- Nenhum SQL ou Edge Function é necessário nesta versão.
