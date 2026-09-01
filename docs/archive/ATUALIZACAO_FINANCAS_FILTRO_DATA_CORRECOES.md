# CONSTANCCE — CORREÇÕES EM FINANÇAS + FILTRO POR DATA

Base:
CONSTANCCE-FINANCAS-REFINADAS-RESPONSIVAS.zip

## Correções
- cabeçalho de Finanças reconstruído para impedir sobreposição;
- seletor de mês ganhou largura e colunas próprias;
- botões + Entrada e + Saída não disputam mais espaço com o mês;
- o mês agora aparece como "Agosto de 2026", preservando o "de" em minúsculo;
- layout se reorganiza automaticamente em telas menores;
- botões e fontes continuam responsivos para celulares.

## Filtro por data
Na seção Lançamentos foi adicionado um filtro por data exata.
Ele funciona em conjunto com:
- pesquisa;
- tipo de lançamento;
- descrição;
- mês selecionado.

O filtro fica limitado às datas do mês que está sendo visualizado.

## Limpar filtros
Quando existe qualquer filtro ativo, agora aparece "Limpar filtros", que remove:
- pesquisa;
- tipo;
- descrição;
- data.

## Exportação
O botão Exportar agora respeita os filtros ativos.
Se uma data estiver selecionada, o CSV exportado contém apenas os registros encontrados para aquele filtro.

## Responsividade
- cabeçalho em grid no desktop;
- em tablet, controles ocupam a largura disponível sem colisão;
- no celular, seletor do mês ocupa a linha inteira;
- + Entrada e + Saída ficam lado a lado;
- campos de filtro usam tamanho adequado para toque/iOS;
- filtro de data não gera overflow horizontal.

## Preservado
- Financial Intelligence;
- Finanças Free/PRO;
- Treinos Inteligentes;
- Training Intelligence;
- sincronização local + Supabase;
- tarefas e subtarefas;
- notificações;
- Mercado Pago;
- PWA;
- estrutura atual de Perfil e menu.

## Infraestrutura
Nenhum SQL novo.
Nenhuma Edge Function nova.
Nenhuma variável de ambiente nova.

## Validação
O App.jsx passou por parser JSX/TypeScript sem erros de sintaxe.
A instalação completa de dependências não terminou dentro do limite da sessão, então não estou declarando um build completo do Vite como validado.
