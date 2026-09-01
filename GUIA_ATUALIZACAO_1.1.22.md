# Atualização 1.1.22

1. Publique o projeto completo na Vercel.
2. No Terminal, dentro da pasta da 1.1.22, publique `domain-sync`:

```bash
npx supabase functions deploy domain-sync --project-ref opuirvfoxrqfkvbihfbs --use-api
```

O deploy inclui automaticamente `supabase/functions/_shared/security.ts`.

3. Não é necessário executar SQL novo. A tabela `device_sync` já existe desde o hardening 1.1.16.
4. Teste criando/alterando um item no dispositivo A e abrindo a mesma conta no dispositivo B. Ao focar o app ou em até ~12 segundos, os dados devem ser atualizados.
5. PWAs instalados antes da troca de domínio continuam aceitos temporariamente no backend. Recomenda-se reinstalá-los em `https://constancceapp.com` quando possível.
