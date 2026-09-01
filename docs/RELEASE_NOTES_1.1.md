# Constancce 1.1 — Production Hardening

Base: `CONSTANCCE-ROTINA-INTELIGENTE-DIETA-TREINOS.zip`

## Engenharia

- CSS principal extraído do `App.jsx`.
- Base alimentar extraída e carregada sob demanda.
- UI primitives extraídos para `src/components/ui.jsx`.
- regras Free/PRO extraídas para `src/lib/plans.js`.
- estado de domínio centralizado em `useConstancceData`.
- Notificações e Relatórios carregados com `React.lazy`.
- schema versionado e migração automática de dados antigos.
- Error Boundary e observabilidade local.
- GitHub Actions para testes + build em cada push/PR.
- Dependabot semanal.

## Segurança

- novo `constancce_domain_sync` com RLS;
- escrita de dados pela Edge Function `domain-sync`;
- limites Free validados também no backend;
- usuários que possuíam mais dados durante PRO/trial mantêm os dados ao voltar ao Free, mas não podem aumentar além do uso pré-existente;
- `food-search` confirma entitlement PRO no servidor;
- `activity-event` grava ledger via Service Role;
- `client-telemetry` grava eventos sem acesso direto do cliente à tabela;
- escrita direta em `device_sync` bloqueada após migração;
- CSP, HSTS, X-Frame-Options, nosniff, Referrer Policy e Permissions Policy;
- `.env.example` sem credenciais reais.

## Sincronização e escala

- dados divididos em account/habits/tasks/goals/workouts/diet/finance;
- alterações enviam somente o domínio afetado;
- debounce remoto aumentado para reduzir chamadas;
- payload remoto reduzido aos campos alterados;
- checkpoint de segurança apenas quando existe estado local não sincronizado;
- `device_sync` permanece como fallback de leitura durante migração;
- notificações server-side leem o novo domain sync.

## Produto/UX

- sidebar agrupada por contexto;
- Hoje muda para Fechamento do dia à noite;
- detalhes transparentes do streak ao tocar no foguinho;
- XP passa a ter piso monotônico e não diminui após exclusões/edições históricas;
- tarefas recorrentes entram no cálculo de XP;
- Notificações PRO: Discreto, Equilibrado e Persistente;
- ação Push para adiar tarefa por 1 hora;
- legibilidade mobile reforçada;
- Modal com foco controlado, Escape e ARIA.

## Privacidade e observabilidade

- erros técnicos possuem sanitização básica de e-mail, URL e bearer token;
- analytics de uso dependem de consentimento explícito no Perfil;
- erros essenciais podem ser registrados para diagnóstico;
- exclusão de conta remove domain sync, telemetria e ledger.

## Validação executada neste ambiente

- 12/12 testes automáticos aprovados;
- parser TypeScript/JSX aprovado nos módulos do frontend;
- todas as Edge Functions passaram por transpile/syntax check;
- JSONs de configuração validados;
- resolução de imports locais validada.

O build Vite completo não foi executado neste ambiente porque a instalação npm não conseguiu concluir por indisponibilidade de rede do runtime. O repositório inclui GitHub Actions com `npm ci` + `npm run verify`, e a Vercel executará o build real ao publicar.
