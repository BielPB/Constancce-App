# Constancce 1.1.20 — Mobile Time + Multi-device Sync

## Correções

### Tarefas no mobile
- Campo `type=time` agora respeita 100% da largura do card no Safari/iOS.
- `min-width: 0`, `max-width: 100%`, `appearance: none` e sizing defensivo.
- Horário centralizado e ícone branco preservado.
- Fonte mínima de 16px no mobile para evitar zoom automático do Safari.

### Sincronização entre dispositivos
- Ao entrar na mesma conta em outro dispositivo, a nuvem é consultada antes do cache local.
- Um dispositivo novo não envia estado local vazio antes de consultar o servidor.
- `domain-sync` agora aceita GET autenticado para devolver o snapshot consolidado da conta.
- O app puxa atualizações quando:
  - faz login;
  - volta ao primeiro plano;
  - recupera internet;
  - o usuário toca em sincronizar;
  - a cada 60 segundos quando não há alterações pendentes.
- Alterações offline são preservadas nos domínios modificados durante a reconciliação.
- Escritas usam controle otimista por domínio (`expectedDomainUpdatedAt`).
- Se outro dispositivo alterou o mesmo domínio, a escrita antiga recebe 409 em vez de sobrescrever dados silenciosamente.
- Antes de adotar a versão da nuvem em um conflito, o app salva um snapshot local de recuperação.

## Deploy necessário
Além do frontend, republique:

```bash
npx supabase functions deploy domain-sync --project-ref opuirvfoxrqfkvbihfbs --use-api
```

Não há SQL novo nesta versão.
