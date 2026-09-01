# Correção do build na Vercel

Foi corrigido um erro de estrutura JSX na seção **Lançamentos do mês** da aba Finanças.

O problema era causado por dois elementos `<div>` residuais do layout anterior, que ficaram abertos antes do novo cabeçalho responsivo de lançamentos. Isso fazia o parser chegar à função `ProgressFriendComparison` ainda esperando o fechamento do JSX anterior e gerava o erro `Unexpected "const"` na linha seguinte.

Correção aplicada:
- removidos os dois wrappers JSX residuais;
- estrutura da seção Finanças normalizada;
- funcionalidades da última versão preservadas.
