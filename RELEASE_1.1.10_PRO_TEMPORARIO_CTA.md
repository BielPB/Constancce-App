# Constancce 1.1.10 — PRO temporário + CTA vitalício

## Alterações
- O card do plano no Perfil agora destaca usuários com PRO temporário.
- Exibe a quantidade de dias restantes com base em `trial_ends_at`.
- Inclui CTA direto `Garantir PRO Vitalício — R$ 37,90` durante o período de teste/cortesia.
- O CTA usa o fluxo existente `handleLifetimeCheckout`, sem criar checkout paralelo.
- O botão entra em estado de carregamento enquanto o Mercado Pago é aberto.
- Corrigido o resumo visual do plano Free para mostrar 5 tarefas ativas, coerente com o limite real.
- Usuários vitalícios não veem o CTA de compra temporária.
