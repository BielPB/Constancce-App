# CONSTANCCE — TREINO HISTÓRICO + DESFAZER + HÁBITOS

## Treinos
- Corrigido o clique em sessões do Histórico.
- O histórico agora abre exatamente a sessão selecionada pelo ID, inclusive sessões de datas anteriores.
- Sessões concluídas abrem em modo de visualização, sem alterar séries/cargas por acidente.
- Adicionado botão "Desfazer conclusão".
- Antes de desfazer, o app exige confirmação.
- Ao desfazer, séries e cargas permanecem registradas; somente o status volta para "Em andamento".
- O usuário pode então corrigir o treino e concluir novamente.
- A comparação de "Última carga" usa a data da sessão aberta, não apenas a data de hoje.

## Hábitos
A seção foi redesenhada:
- painel de progresso diário;
- quantidade concluída/pendente;
- hábitos que contam para streak;
- quantidade pausada;
- filtros Hoje / Todos / Pausados;
- consistência individual dos últimos 7 dias;
- cards premium;
- etapas com progresso próprio;
- ações de pausar, editar e excluir reorganizadas;
- responsividade mobile reforçada.

## Infraestrutura
Nenhum SQL novo.
Nenhuma alteração de Edge Function é necessária especificamente para esta versão.
O sistema reforçado de sincronização da versão anterior foi preservado.
