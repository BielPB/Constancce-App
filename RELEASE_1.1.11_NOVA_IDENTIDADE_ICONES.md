# Constancce 1.1.11 — Nova identidade de logo e ícones

## Nova marca no app
- O símbolo principal foi substituído pelo novo foguinho sólido do Constancce.
- Tela de login, carregamento inicial e marca da sidebar agora usam o novo ícone oficial.
- Elementos funcionais de streak continuam usando o ícone de chama funcional, preservando a leitura de interface.

## Favicon e instalação no celular
- Novo favicon de alto contraste: fundo lime `#C6FF34` e foguinho preto sólido.
- Novos assets em 16, 32, 180, 192, 512 e 1024 px.
- Adicionado `favicon.ico` para compatibilidade com navegadores.
- Adicionado ícone `maskable` de 512 px para Android/PWA, com zona segura para recortes do sistema.
- `apple-touch-icon` atualizado para iPhone/iPad.
- Manifest atualizado com ícones `any` e `maskable`.

## Atualização de cache
- Service Worker atualizado para `constancce-shell-v10` para forçar a renovação dos ícones em novas versões do PWA.
- Versões dos links de manifest/favicon foram incrementadas para evitar cache antigo do navegador.

> Observação: em aparelhos onde o Constancce já estava instalado, pode ser necessário remover o atalho/app da Tela de Início e instalar novamente para o iOS/Android substituir o ícone armazenado pelo sistema.
