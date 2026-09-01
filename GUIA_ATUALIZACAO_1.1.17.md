# Atualização Constancce 1.1.17

Esta versão parte da 1.1.16 Security Hardening e preserva as proteções de produção.

## 1. Publicar frontend
Publique o conteúdo da versão 1.1.17 na Vercel normalmente.

## 2. Republicar `domain-sync` no Supabase
Os novos limites Free também são validados no servidor. Por isso, após o deploy do frontend, abra o CMD dentro da pasta do projeto e execute:

```cmd
npx supabase functions deploy domain-sync --project-ref SEU_REFERENCE_ID --use-api
```

Use o mesmo Reference ID do projeto Supabase que você já vinculou anteriormente.

## 3. Conferir Edge Function
No Supabase:

`Edge Functions > domain-sync`

Confirme que a data de atualização corresponde ao deploy atual.

## 4. Não executar SQL novo
A versão 1.1.17 não exige nova migration SQL. Continue mantendo a migration de segurança 1.1.16 já aplicada.

## 5. Testes rápidos
- Perfil > Módulos: no mobile os switches devem ficar compactos (40 x 24 px).
- Hoje: em conta antiga, tocar em “Conheça sua tela Hoje” deve marcar o item como concluído.
- Finanças: “Próximas contas” deve listar todas as pendentes do mês automaticamente.
- Free: o 9º lançamento financeiro deve abrir o paywall PRO.
- Free: uma segunda meta ativa deve abrir o paywall PRO.
- Free: o 3º alimento na mesma refeição/dia deve abrir o paywall PRO.
- PRO/trial válido: esses novos limites não se aplicam.

## Compatibilidade com contas antigas
Nenhum dado acima do novo limite é apagado. Contas Free antigas que já tenham mais itens continuam vendo os registros existentes, mas não podem aumentar o uso enquanto estiverem acima do limite Free.
