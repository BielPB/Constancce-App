# CONSTANCCE — METAS INTELIGENTES + GOAL INTELLIGENCE PRO

Base:
CONSTANCCE-CALENDARIO-INTELIGENTE-MOBILE-FIX.zip

## Nova arquitetura de Metas
A seção foi reorganizada em:
1. Visão geral
2. Em andamento
3. Concluídas

## Visão geral
- quantidade de metas ativas;
- meta mais próxima da conclusão;
- quantidade de metas no ritmo;
- metas que precisam de atenção;
- destaque para uma Meta principal;
- outras metas em cards compactos;
- Goal Intelligence integrado.

## Meta principal
Agora uma meta pode ser marcada como principal.
- somente uma meta pode ficar como principal;
- aparece em destaque dentro de Metas;
- também aparece na tela Hoje/Dashboard;
- mostra percentual, valores e próxima ação.

## Status automático
Estados calculados:
- No ritmo;
- Atenção;
- Parada;
- Em andamento;
- Concluída.

O cálculo considera:
- progresso atual;
- prazo;
- tempo decorrido;
- dias sem avanço.

## Próxima ação
Cada meta pode possuir uma próxima ação concreta.
Exemplos:
- Guardar R$ 500 neste mês;
- Finalizar módulo 3;
- Fazer 4 treinos.

A ação pode ser marcada como concluída e entra no histórico interno de ações da meta.

## Progresso rápido
Metas financeiras:
- R$ 50
- R$ 100
- R$ 500
- Outro

Metas numéricas:
- +1
- +5
- +10
- Outro

## Marcos
- trilha visual de marcos;
- marco atual e próximo marco destacados;
- celebração automática quando um marco é ultrapassado;
- mantém milestones existentes.

## Histórico e evolução
- múltiplos avanços no mesmo dia agora são preservados;
- histórico individual de cada avanço;
- gráfico fino de evolução;
- Free vê os últimos 30 dias;
- PRO vê o histórico completo.

## Relacionamentos
Uma meta pode ser conectada a:
- tarefas;
- hábitos.

Dentro dos detalhes da meta é possível visualizar os itens relacionados.

## Check-in semanal
Opções:
- Avancei bastante
- Avancei pouco
- Não avancei

O check-in positivo contribui para a leitura de atividade da meta.
“Não avancei” é registrado, mas não é considerado progresso.

## Prazo opcional
Metas não precisam mais obrigatoriamente possuir uma data final.
Sem prazo:
- status Em andamento;
- não força cálculo de ritmo;
- usuário pode adicionar prazo depois.

## PRO — Ritmo da meta
Score de 0 a 100 considerando:
- progresso;
- relação com o prazo;
- recência das atualizações;
- marcos alcançados.

Classificações:
- Forte;
- Estável;
- Atenção;
- Fraco.

## PRO — Ritmo necessário
Com prazo definido:
- metas financeiras: valor necessário por mês;
- demais metas: avanço necessário por semana.

## PRO — Previsão de conclusão
O Constancce estima a data de conclusão usando o ritmo real registrado.
Também compara a previsão com o prazo:
- antes do prazo;
- no prazo;
- depois do prazo.

## Goal Intelligence — PRO
Leituras automáticas:
- meta mais próxima da conclusão;
- meta que merece mais atenção;
- meta sem progresso há mais tempo;
- projeção da meta principal;
- quantidade de metas concluídas nos últimos 6 meses.

Perguntas:
- Qual meta está mais atrasada?
- Qual meta estou mais perto de concluir?
- Quanto preciso guardar por mês?
- Se continuar nesse ritmo, quando termino?
- Em qual meta estou há mais tempo sem avançar?

Também entende o nome de uma meta quando ele aparece na pergunta.

## Concluídas
- histórico separado;
- data de conclusão;
- indicação de conclusão antes/depois do prazo;
- arquivamento continua PRO;
- restauração de arquivadas preservada.

## Visual
- cards mais aspiracionais;
- percentuais grandes;
- barras finas;
- marcos conectados;
- gradientes discretos;
- hierarquia visual limpa;
- Goal Intelligence no mesmo padrão tecnológico das outras inteligências.

## Mobile
- tabs responsivas e sticky;
- botão Nova meta ocupa largura adequada;
- progresso rápido reorganizado;
- formulários em 16px para evitar zoom no iOS;
- cards e gráficos adaptados para telas pequenas;
- overscroll global de modais continua corrigido;
- troca de seção continua levando ao topo.

## Preservado
- Calendar Intelligence;
- Task Intelligence;
- Financial Intelligence;
- Training Intelligence;
- Calendário Hoje/Semana/Mês;
- filtro por data em Finanças;
- Tarefas Inteligentes;
- Treinos Inteligentes;
- Supabase/local sync;
- Mercado Pago;
- notificações;
- PWA;
- regras Free/PRO;
- fotos antigas preservadas;
- Perfil permanece por último;
- Jornada/Desafios continuam ocultos;
- Google Calendar continua fora do produto.

## Infraestrutura
Nenhum SQL novo.
Nenhuma Edge Function nova.
Nenhuma variável de ambiente nova.

## Validação
O App.jsx passou pelo parser TypeScript/JSX (`tsc`) sem erros de sintaxe.
Foram realizadas verificações estáticas dos recursos adicionados e das funcionalidades críticas preservadas.

Não foi executado um build completo do Vite nesta atualização.
