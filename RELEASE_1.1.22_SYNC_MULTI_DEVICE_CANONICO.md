# Constancce 1.1.22 — Sincronização multi-dispositivo canônica

## Correções
- Cada gravação por domínio também atualiza um snapshot integral da conta em `device_sync`.
- O GET de sincronização auto-repara o snapshot integral a partir dos domínios mais recentes.
- O backend reconstrói a conta completa antes de persistir, evitando perda de dados de outras abas.
- PWAs instalados no domínio antigo da Vercel continuam autorizados temporariamente para sincronização.
- CORS explicita GET/POST/OPTIONS.
- O bootstrap renova o JWT antes do primeiro pull remoto.
- Dispositivos visíveis consultam alterações remotas a cada 12 segundos e ao receber foco/pageshow.
- Cache local continua como fallback offline, mas a nuvem é a fonte principal entre dispositivos.
