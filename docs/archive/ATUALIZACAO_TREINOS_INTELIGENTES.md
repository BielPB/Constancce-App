# CONSTANCCE — TREINOS INTELIGENTES (BÁSICO + PRO)

Base utilizada:
CONSTANCCE-FINANCIAL-INTELLIGENCE-ENGINE.zip

## Estrutura da aba
A aba Treinos agora foi organizada em três áreas simples:
1. Hoje
2. Meus treinos
3. Evolução

## Funções básicas
- treino do dia em destaque;
- progresso do treino atual;
- semana visual com realizado/programado;
- aviso de treino de ontem não realizado + "Fazer hoje";
- modo de execução mais limpo;
- descanso automático após concluir uma série (60s, 90s ou 120s);
- comparação da carga atual com o treino anterior;
- sugestão simples de +2,5 kg quando a carga ficou igual nas duas últimas sessões;
- identificação de PR de carga;
- volume estimado da sessão;
- resumo depois da conclusão;
- duração da sessão;
- observações por exercício;
- esforço percebido opcional;
- frequência muscular dos últimos 7 dias;
- recordes básicos de carga;
- favoritos de exercícios;
- biblioteca de nomes já usados para reutilização rápida;
- substituição temporária de exercício somente na sessão atual.

## PRO
- progressão de carga em gráfico;
- histórico completo;
- compartilhamento de treino;
- treinos ilimitados;
- Training Intelligence.

## Training Intelligence
A análise é determinística e usa somente os dados registrados no Constancce.
Ela pode identificar:
- exercício que mais evoluiu em carga;
- exercício há 3 sessões na mesma carga;
- aumento ou queda de volume nos últimos 30 dias.

Não existe IA externa nem valor inventado nesse módulo.

## Segurança dos dados
Novos dados da sessão são salvos no mesmo `workoutSessions` já sincronizado:
- startedAt
- durationMinutes
- effortRating
- exerciseNotes
- exerciseOverrides

A estrutura existente de sincronização local + Supabase foi preservada.

## Infraestrutura
Nenhum SQL novo.
Nenhuma Edge Function nova.
Nenhuma nova variável de ambiente.
