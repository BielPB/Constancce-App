# Constancce 1.1.17 — UX mobile + limites Free

## Ajustes
- Toggles de ativar/desativar módulos permanecem compactos (40x24px) no mobile.
- O item “Conheça sua tela Hoje” agora conclui corretamente o checklist também em contas antigas.
- “Próximas contas” exibe automaticamente todas as contas pendentes do mês selecionado, sem botão Gerenciar.
- Plano Free: até 8 lançamentos financeiros.
- Plano Free: até 1 meta ativa.
- Plano Free: até 2 alimentos por refeição/dia.
- Limites críticos também são validados pela Edge Function `domain-sync` para não depender apenas do frontend.

## Deploy obrigatório
Como `supabase/functions/domain-sync/index.ts` foi alterada, após publicar o frontend execute:

```cmd
npx supabase functions deploy domain-sync --project-ref SEU_PROJECT_REF --use-api
```

Não há migration SQL nova nesta release.
