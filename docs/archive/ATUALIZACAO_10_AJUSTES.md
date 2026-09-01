# CONSTANCCE — AJUSTES DE PERSONALIZAÇÃO, MOBILE, TREINOS, DIETA, METAS E CONQUISTAS

## 1. Perfil — cores
O usuário pode escolher a cor principal do Constancce:
- Verde
- Rosa
- Azul
- Roxo

A escolha fica salva no perfil e sincroniza entre dispositivos.

## 2. Navegação mobile por gesto
Em celulares, é possível navegar entre as abas visíveis arrastando a tela horizontalmente.
Gestos iniciados em inputs, botões, selects e áreas com scroll horizontal são ignorados para evitar conflitos.

## 3. Tipografia mobile
As principais escalas de fonte foram ajustadas com clamp() para se adaptar melhor a diferentes larguras de celular.
Inputs permanecem com pelo menos 16px para evitar zoom automático no iOS.

## 4. Correção de texto
Todas as ocorrências encontradas de "Meses" foram corrigidas para "Meses".

## 5. Backup
A opção de backup/restauração foi removida da interface do aplicativo.

## 6. Dieta
A aba antes chamada Alimentação agora se chama Dieta.
A categoria financeira "Alimentação" continua inalterada.

## 7. Compartilhamento de treinos
Cada treino pode gerar um link externo.
- usa o compartilhamento nativo quando disponível;
- fallback para copiar o link;
- o amigo pode abrir o link e importar o treino;
- também existe o botão Receber para colar manualmente um link/código;
- treinos recebidos ganham novos IDs para não interferir no histórico do remetente.

## 8. TMB
A aba Dieta calcula automaticamente a Taxa Metabólica Basal usando a fórmula de Mifflin-St Jeor.
Dados usados:
- sexo;
- idade;
- peso;
- altura.

É exibido como estimativa em kcal/dia.

## 9. Metas
- foto opcional por meta;
- imagem otimizada antes de sincronizar;
- foto exibida no card;
- metas concluídas podem ser arquivadas;
- área Arquivadas permite restaurar uma meta.

## 10. Conquistas
A tela foi simplificada para quatro níveis de recompensa:
- Comum
- Rara
- Épico
- Lendário

Cada nível possui um prêmio e uma barra de progresso.

## Infraestrutura
Nenhum SQL novo é necessário para estes ajustes.
As novas preferências e informações são armazenadas no perfil/device_sync existente.
