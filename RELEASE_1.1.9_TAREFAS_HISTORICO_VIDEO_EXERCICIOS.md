# Constancce 1.1.9 — Tarefas completas, histórico diário e vídeos de exercícios

## Tarefas

- Descrições dos cards não usam mais `line-clamp`.
- Todo o texto digitado pelo usuário fica visível no card, inclusive em múltiplas linhas.
- CSS defensivo remove `text-overflow`, clipping e truncamento por WebKit.

## Treinos > Hoje

- Os dias anteriores exibidos em **Sua semana** agora são clicáveis.
- Ao tocar em um dia passado, abre um mini histórico daquele dia.
- O histórico mostra:
  - treino realizado;
  - status concluído/parcial;
  - séries realizadas;
  - volume registrado;
  - exercícios;
  - carga de cada exercício.
- Se havia treino programado, mas não houve execução, isso é informado.
- Se não houve treino naquele dia, o modal informa que não existe registro.

## Vídeo explicativo por exercício

- O nome do exercício dentro do treino em execução agora é clicável.
- Ao tocar no nome, abre um modal de execução do exercício.
- Cada exercício pode receber uma URL de vídeo ao editar/criar o treino.
- Formatos suportados:
  - YouTube;
  - YouTube Shorts;
  - Vimeo;
  - MP4/URL de vídeo direto, incluindo arquivos hospedados em storage/CDN.
- Vídeos de YouTube são convertidos para embed `youtube-nocookie`.
- O vídeo só é carregado quando o usuário abre o guia, reduzindo consumo de dados e evitando peso na tela de Treinos.
- Quando o mesmo exercício aparece novamente com o mesmo nome, o app reaproveita o vídeo já cadastrado na biblioteca daquele usuário.
- Compartilhamento/importação de treinos preserva `videoUrl`.

## Validação

- 31 testes automatizados aprovados.
