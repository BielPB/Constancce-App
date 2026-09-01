# Guia de atualização — Constancce 1.1.20

## 1. Frontend
Faça o deploy do projeto completo na Vercel.

## 2. Edge Function obrigatória
Abra o Terminal na pasta da 1.1.20 e execute:

```bash
npx supabase functions deploy domain-sync --project-ref opuirvfoxrqfkvbihfbs --use-api
```

Confirme no painel Supabase > Edge Functions > domain-sync que a atualização é recente.

## 3. Não precisa executar SQL
A migration de segurança 1.1.16 continua válida.

## 4. Teste de sincronização recomendado
1. No dispositivo A, entre na conta e crie uma tarefa.
2. Aguarde aparecer como salvo.
3. No dispositivo B, entre na mesma conta.
4. O registro deve ser carregado da nuvem.
5. Com os dois abertos, altere um dado no A.
6. No B, volte para outra aba/app e retorne ao Constancce ou use o botão de sincronização.
7. O dado remoto deve aparecer.
8. Teste também desligar a internet no A, alterar um domínio, alterar outro domínio no B e depois reconectar o A.

## 5. Campo de horário no iPhone
Abra Tarefas > Nova tarefa. O seletor deve permanecer totalmente dentro do card, sem ultrapassar a lateral do modal.
