# Constancce 1.1.21 — Persistência e sincronização durável

## Problema corrigido
Na 1.1.20, alterações ainda aguardando envio existiam apenas em memória. Se o usuário fechasse o PWA, atualizasse a página ou trocasse de versão antes do debounce terminar, a fila podia desaparecer. Além disso, duas alterações rápidas no mesmo domínio podiam usar uma versão de sincronização antiga e gerar conflito com a própria gravação anterior.

## Correções
- fila de sincronização persistida por usuário no dispositivo;
- retomada automática da fila após refresh, fechamento e atualização do PWA;
- cache local salvo imediatamente antes da tentativa de rede;
- `expectedDomainUpdatedAt` usa sempre a versão remota mais recente conhecida no momento do envio;
- alterações feitas durante uma requisição em andamento não são sobrescritas pelo snapshot anterior;
- conflito real entre dispositivos faz rebase: baixa a nuvem e reaplica somente os campos locais ainda pendentes;
- alterações rápidas em campos diferentes do mesmo domínio são combinadas sem perder a primeira;
- autosave detecta mutações que eventualmente não chamem `persist()` e também as envia para a nuvem;
- fila persistida em formato reduzido por domínio para diminuir consumo de `localStorage`;
- Service Worker recebeu novo cache `constancce-shell-v21`.

## Deploy
Esta versão altera somente frontend/lógica cliente. O contrato da Edge Function `domain-sync` continua compatível com a 1.1.20.

1. Publique o projeto completo 1.1.21 na Vercel.
2. Não é necessário executar SQL.
3. Não é necessário republicar Edge Functions se `domain-sync` da 1.1.20 já estiver publicado.

## Validação recomendada
1. Faça login no mesmo usuário em dois dispositivos.
2. Crie/conclua registros e aguarde o indicador de salvamento.
3. Atualize a página e confirme que o histórico permanece.
4. Faça uma alteração, feche o PWA imediatamente e abra novamente; a alteração deve continuar visível e ser sincronizada.
5. Faça uma alteração offline, feche o app, reabra ainda offline e confirme a persistência. Depois conecte a internet e valide o envio para o outro dispositivo.
