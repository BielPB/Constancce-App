import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../App.jsx", import.meta.url), "utf8");
const ui = await readFile(new URL("../src/components/ui.jsx", import.meta.url), "utf8");
const foodSearch = await readFile(new URL("../supabase/functions/food-search/index.ts", import.meta.url), "utf8");
const notifications = await readFile(new URL("../supabase/functions/send-due-notifications/index.ts", import.meta.url), "utf8");
const restTimerHook = await readFile(new URL("../src/hooks/useWorkoutRestTimer.js", import.meta.url), "utf8");
const reportsView = await readFile(new URL("../src/features/reports/ReportsView.jsx", import.meta.url), "utf8");
const workoutsView = await readFile(new URL("../src/features/workouts/WorkoutsView.jsx", import.meta.url), "utf8");
const workoutTemplateForm = await readFile(new URL("../src/features/workouts/WorkoutTemplateForm.jsx", import.meta.url), "utf8");
const financeView = await readFile(new URL("../src/features/finance/FinanceView.jsx", import.meta.url), "utf8");
const financeBillForm = await readFile(new URL("../src/features/finance/FinanceBillForm.jsx", import.meta.url), "utf8");

test("regressões críticas permanecem protegidas", () => {
  assert.match(app, /const renderCurrentView = \(\) =>/);
  assert.match(app, /\{renderCurrentView\(\)\}/);
  assert.doesNotMatch(app, /<CurrentView\s*\/>/);
  assert.doesNotMatch(app, /Task Intelligence · PRO/);
  assert.doesNotMatch(app.toLowerCase(), /google_calendar/);
  assert.match(app, /monthlyLimit \?\? 3000/);
});

test("modal possui acessibilidade mínima de produção", () => {
  assert.match(ui, /role="dialog"/);
  assert.match(ui, /aria-modal="true"/);
  assert.match(ui, /event\.key === "Escape"/);
  assert.match(ui, /aria-labelledby=\{titleId\}/);
});

test("food-search exige plano PRO no backend", () => {
  assert.match(foodSearch, /constancce_access/);
  assert.match(foodSearch, /pro_required/);
  assert.match(foodSearch, /requireVerifiedUser/);
  assert.match(foodSearch, /email_not_confirmed/);
});

test("notificações suportam orçamento de atenção", () => {
  assert.match(notifications, /reminderIntensity/);
  assert.match(notifications, /balanced/);
  assert.match(notifications, /discreet/);
  assert.match(notifications, /task-overdue-hourly/);
});

test("sync por domínio e schema version estão ativos", () => {
  assert.match(app, /constancce_domain_sync/);
  assert.match(app, /DATA_SCHEMA_VERSION/);
  assert.match(app, /buildDataPayload/);
});


test("XP é monotônico e tarefas recorrentes entram no cálculo", () => {
  assert.match(app, /profile\?\.xpFloor/);
  assert.match(app, /task\.completionDates \|\| \[\]/);
  assert.match(app, /Math\.max\(earnedXp,Number\(profile\?\.xpFloor\|\|0\)\)/);
});


test("ledger de atividade usa Edge Function autenticada", async () => {
  const activity = await readFile(new URL("../supabase/functions/activity-event/index.ts", import.meta.url), "utf8");
  assert.match(app, /functions\/v1\/activity-event/);
  assert.match(activity, /requireVerifiedUser/);
  assert.match(activity, /ALLOWED_EVENTS/);
});


test("cronômetro de descanso é global e persistente", async () => {
  const restHook = await readFile(new URL("../src/hooks/useWorkoutRestTimer.js", import.meta.url), "utf8");
  assert.match(restHook, /endAt/);
  assert.match(restHook, /localStorage/);
  assert.match(restHook, /visibilitychange/);
  assert.match(restHook, /finishedTimer/);
  assert.match(app, /workout-global-rest/);
  assert.match(app, /Descanso finalizado/);
});

test("campo de carga não sincroniza a cada tecla e modal preserva foco", async () => {
  assert.match(workoutsView, /function WorkoutLoadInput/);
  assert.match(workoutsView, /onBlur=\{\(\) =>/);
  assert.doesNotMatch(workoutsView, /className="workout-load-input[^"]*"[\s\S]{0,350}onChange=\{\(event\) =>\s*updateLoad/);
  assert.match(ui, /onCloseRef/);
  assert.match(ui, /\}, \[\]\);/);
});


test("foguinho da tela Hoje usa streak de presença no app", async () => {
  const usage = await readFile(new URL("../src/lib/usageStreak.js", import.meta.url), "utf8");
  assert.match(usage, /computeUsageStreaks/);
  assert.match(app, /appUsageDays/);
  assert.match(app, /streaks=\{usageStreaks\}/);
  assert.match(app, /Sua sequência de uso/);
  assert.match(app, /Cada dia em que você abre e usa o Constancce/);
});


test("usage streak v3 mantém a correção de criação automática", async () => {
  const usage = await readFile(new URL("../src/lib/usageStreak.js", import.meta.url), "utf8");
  assert.doesNotMatch(usage, /add\(habit\?\.createdAt\)/);
  assert.doesNotMatch(usage, /add\(task\?\.createdAt\)/);
  assert.match(app, /appUsageStreakVersion: 3/);
});


test("usage streak v3 usa a mesma atividade do Progresso e respeita criação da conta", () => {
  assert.match(app, /appUsageStreakVersion: 3/);
  assert.match(app, /getDayPerformance\(/);
  assert.match(app, /performance\.score > 0/);
  assert.match(app, /session\?\.user\?\.created_at/);
  assert.match(app, /date < accountCreatedDate/);
  assert.match(app, /computeUsageStreaks\(usageDaysForToday/);
});


test("Dieta carrega catálogo TACO e permite adicionar alimentos com macros", async () => {
  const taco = await readFile(new URL("../src/data/tacoFoodBase.js", import.meta.url), "utf8");
  assert.match(taco, /loadTacoFoodBase/);
  assert.match(taco, /raw\.githubusercontent\.com/);
  assert.match(taco, /TACO_CACHE_KEY/);
  assert.match(app, /dietFoodSearchScore/);
  assert.match(app, /foodLibraryResults/);
  assert.match(app, /Proteínas/);
  assert.match(app, /Carboidratos/);
  assert.match(app, /Gorduras/);
  assert.match(app, /Adicionar à dieta de hoje/);
  assert.match(app, /load_taco_food_base/);
  assert.match(app, /DIET_FOOD_BASE/);
  assert.match(app, /useState\(\(\) => dietDedupFoods\(DIET_FOOD_BASE\)\)/);
  assert.match(app, /dietBaseLoadStartedRef/);
  assert.doesNotMatch(app, /\[view, dietFoodBase\.length, dietBaseLoading\]/);
});


test("Basic limita tarefas ativas a 5 no app e no backend", async () => {
  const plans = await readFile(new URL("../src/lib/plans.js", import.meta.url), "utf8");
  const domainSync = await readFile(new URL("../supabase/functions/domain-sync/index.ts", import.meta.url), "utf8");
  assert.match(plans, /activeTasks:\s*5/);
  assert.match(plans, /até 5 tarefas ativas/);
  assert.match(domainSync, /activeTasks:\s*5/);
  assert.match(app, /5 hábitos · 5 tarefas ativas/);
});

test("treino mostra última carga registrada e UI fixa não usa botão global de mais", async () => {
  const styles = await readFile(new URL("../src/styles/app.css", import.meta.url), "utf8");
  assert.match(workoutsView, /workoutPreviousExerciseLoad/);
  assert.match(workoutsView, /session\.date < beforeDate/);
  assert.doesNotMatch(app, /<QuickAdd/);
  assert.doesNotMatch(app, /function QuickAdd/);
  assert.match(app, /app-authenticated-root/);
  assert.match(styles, /\.app-authenticated-root \.app-main/);
  assert.match(styles, /overflow-y:auto/);
  assert.match(styles, /\.mobile-nav\{[\s\S]*position:fixed !important/);
  assert.match(styles, /transform:translate3d\(-50%,0,0\)/);
});

test("tarefas exibem descrição completa sem truncamento", async () => {
  const styles = await readFile(new URL("../src/styles/app.css", import.meta.url), "utf8");
  assert.doesNotMatch(app, /task-card-description[^\n]*line-clamp-2/);
  assert.match(app, /task-card-description[^\n]*whitespace-pre-wrap/);
  assert.match(styles, /\.task-card-description\{[\s\S]*overflow:visible !important/);
  assert.match(styles, /-webkit-line-clamp:unset !important/);
});

test("Treinos Hoje abre mini histórico ao tocar em dias passados", () => {
  assert.match(workoutsView, /selectedHistoryDate/);
  assert.match(workoutsView, /if \(isPast\) setSelectedHistoryDate\(date\)/);
  assert.match(workoutsView, /Mini histórico/);
  assert.match(workoutsView, /Nenhum treino registrado neste dia/);
  assert.match(workoutsView, /selectedHistorySessions/);
});

test("nome do exercício abre vídeo explicativo sob demanda", () => {
  assert.match(workoutsView, /workoutVideoSource/);
  assert.match(workoutTemplateForm, /Vídeo explicativo \(YouTube, Vimeo ou MP4\)/);
  assert.match(workoutsView, /workout-exercise-guide-trigger/);
  assert.match(workoutsView, /setExerciseGuide\(/);
  assert.match(workoutsView, /youtube-nocookie\.com\/embed/);
  assert.match(workoutsView, /<video[\s\S]*controls[\s\S]*playsInline/);
  assert.match(workoutsView, /O vídeo só é carregado quando você toca no nome do exercício/);
});


test("Perfil oferece compra vitalícia durante PRO temporário", () => {
  assert.match(app, /Acesso PRO temporário/);
  assert.match(app, /dias restantes/);
  assert.match(app, /Garantir PRO Vitalício — R\$ 37,90/);
  assert.match(app, /onBuyLifetime=\{handleLifetimeCheckout\}/);
  assert.match(app, /disabled=\{checkoutLoading\}/);
});

test("primeiro acesso explica o Constancce em 5 telas antes da personalização", () => {
  assert.match(app, /Bem-vindo ao Constancce/);
  assert.match(app, /Sua vida organizada em um só lugar/);
  assert.match(app, /Comece pelo seu dia\./);
  assert.match(app, /Na aba Hoje você encontra o que precisa acompanhar e concluir/);
  assert.match(app, /Construa sua rotina\./);
  assert.match(app, /Cadastre seus hábitos, tarefas e treinos/);
  assert.match(app, /Organize sua evolução\./);
  assert.match(app, /Use Finanças, Metas e Dieta conforme fizer sentido para você/);
  assert.match(app, /Acompanhe seu progresso\./);
  assert.match(app, /transforma tudo que você registra em uma visão da sua evolução/);
  assert.match(app, /Personalizar meu Constancce/);
  assert.match(app, /onboardingIntroCompleted: true/);
});

test("primeiros 7 dias têm checklist guiado e não criam dados artificiais", () => {
  assert.match(app, /Comece por aqui/);
  assert.match(app, /Configure seu Constancce/);
  assert.match(app, /Crie seu primeiro hábito/);
  assert.match(app, /Adicione uma tarefa/);
  assert.match(app, /Configure seu primeiro treino/);
  assert.match(app, /Defina uma meta/);
  assert.match(app, /Tudo pronto\. Agora é constância/);
  assert.match(app, /O onboarding agora ensina sem preencher a conta automaticamente/);
  assert.doesNotMatch(app, /name: "Planejar o dia", category: "mente"/);
});

test("módulos ensinam na primeira visita e oferecem exemplos prontos", () => {
  assert.match(ui, /export function FirstVisitTip/);
  assert.match(app, /FirstVisitTip id="habits"/);
  assert.match(app, /FirstVisitTip id="tasks"/);
  assert.match(workoutsView, /FirstVisitTip id="workouts"/);
  assert.match(app, /FirstVisitTip id="diet"/);
  assert.match(financeView, /FirstVisitTip id="finance"/);
  assert.match(app, /FirstVisitTip id="goals"/);
  assert.match(app, /Beber 2L de água/);
  assert.match(app, /Planejar meu dia/);
  assert.match(workoutsView, /Usar treino básico/);
  assert.match(app, /Reserva de emergência/);
});

test("Hoje devolve leitura humana diária e semanal", () => {
  assert.match(app, /Resumo do dia/);
  assert.match(app, /dailyHumanSummary/);
  assert.match(app, /weeklyHumanSummary/);
  assert.match(app, /O que isso significa/);
  assert.match(app, /semana anterior/);
});


test("novas contas começam no Free e PRO temporário é somente manual", async () => {
  const hardening = await readFile(new URL("../SUPABASE_SECURITY_HARDENING_1_1_16.sql", import.meta.url), "utf8");
  const plans = await readFile(new URL("../src/lib/plans.js", import.meta.url), "utf8");
  const domainSync = await readFile(new URL("../supabase/functions/domain-sync/index.ts", import.meta.url), "utf8");
  const foodSearch = await readFile(new URL("../supabase/functions/food-search/index.ts", import.meta.url), "utf8");
  const notifications = await readFile(new URL("../supabase/functions/send-due-notifications/index.ts", import.meta.url), "utf8");
  const webhook = await readFile(new URL("../supabase/functions/mercadopago-webhook/index.ts", import.meta.url), "utf8");

  assert.match(hardening, /default 'free'/);
  assert.match(hardening, /values\(new\.id, 'free', null, null, 'none'/);
  assert.match(hardening, /complimentary_trial/);
  assert.match(hardening, /coalesce\(payment_status,'none'\) <> 'complimentary_trial'/);
  assert.match(hardening, /revoke all on function public\.grant_constancce_pro\(text,integer\) from public,\s*anon,\s*authenticated/i);
  assert.match(hardening, /email_confirmed_at/);
  assert.match(plans, /access\.payment_status === "complimentary_trial"/);
  assert.match(domainSync, /payment_status === "complimentary_trial"/);
  assert.match(foodSearch, /payment_status === "complimentary_trial"/);
  assert.match(notifications, /payment_status === "complimentary_trial"/);
  assert.match(webhook, /plan: "free"/);
});

test("hardening 1.1.16 exige e-mail confirmado, RLS e bloqueia escrita direta", async () => {
  const hardening = await readFile(new URL("../SUPABASE_SECURITY_HARDENING_1_1_16.sql", import.meta.url), "utf8");
  const security = await readFile(new URL("../supabase/functions/_shared/security.ts", import.meta.url), "utf8");
  assert.match(app, /isEmailConfirmedUser/);
  assert.match(app, /email_confirmed_at/);
  assert.match(app, /Reenviar e-mail de confirmação/);
  assert.match(hardening, /enable row level security/i);
  assert.match(hardening, /revoke all on table public\.constancce_domain_sync from anon, authenticated/i);
  assert.match(hardening, /grant select on table public\.constancce_domain_sync to authenticated/i);
  assert.match(hardening, /revoke all on function public\.grant_constancce_pro\(text,integer\) from public,\s*anon,\s*authenticated/i);
  assert.match(hardening, /email_confirmed_at/);
  assert.match(security, /requireVerifiedUser/);
  assert.match(security, /email_not_confirmed/);
  assert.doesNotMatch(security, /Access-Control-Allow-Origin": "\*"/);
});

test("Mercado Pago é validado no servidor com ledger e valor fixo", async () => {
  const checkout = await readFile(new URL("../supabase/functions/create-mercadopago-checkout/index.ts", import.meta.url), "utf8");
  const webhook = await readFile(new URL("../supabase/functions/mercadopago-webhook/index.ts", import.meta.url), "utf8");
  assert.match(checkout, /37\.90/);
  assert.match(checkout, /constancce_checkout_sessions/);
  assert.match(checkout, /X-Idempotency-Key/);
  assert.match(webhook, /x-signature/i);
  assert.match(webhook, /constancce_payment_events/);
  assert.match(webhook, /transaction_amount/);
  assert.match(webhook, /currency_id/);
  assert.match(webhook, /checkout_session_id/);
});

test("Edge Functions sensíveis aplicam rate limit e origem restrita", async () => {
  const names = ["activity-event", "client-telemetry", "domain-sync", "food-search", "push-subscription", "delete-account", "create-mercadopago-checkout"];
  for (const name of names) {
    const source = await readFile(new URL(`../supabase/functions/${name}/index.ts`, import.meta.url), "utf8");
    assert.match(source, /originAllowed/);
    assert.match(source, /consumeRateLimit/);
    assert.match(source, /requireVerifiedUser/);
  }
});

test("frontend não contém service role e Vercel envia headers de segurança", async () => {
  const vercel = await readFile(new URL("../vercel.json", import.meta.url), "utf8");
  assert.doesNotMatch(app, /SERVICE_ROLE/);
  assert.match(vercel, /Content-Security-Policy/);
  assert.match(vercel, /Strict-Transport-Security/);
  assert.match(vercel, /X-Frame-Options/);
  assert.match(vercel, /X-Content-Type-Options/);
});


test("SQLs legados não reabrem permissões da arquitetura antiga", async () => {
  const legacy = ["SUPABASE_AUTH_SETUP.sql", "SUPABASE_FRIENDS_SETUP.sql", "SUPABASE_PAYMENT_SETUP.sql", "PRODUCTION_HARDENING_SQL.sql", "SUPABASE_FREE_DEFAULT_MIGRATION.sql"];
  for (const file of legacy) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /DEPRECATED/);
    assert.match(source, /SUPABASE_SECURITY_HARDENING_1_1_16\.sql/);
    assert.doesNotMatch(source, /create policy/i);
  }
});

test("paywall PRO possui componente real e não derruba o React", () => {
  assert.match(app, /function ProUpgradeModal\(/);
  assert.match(app, /<ProUpgradeModal/);
  assert.match(app, /Garantir PRO Vitalício — R\$ 37,90/);
  assert.match(app, /Já paguei · verificar acesso/);
});

test("checkout renova JWT e repete automaticamente após 401", () => {
  assert.match(app, /function ensureFreshAuthSession/);
  assert.match(app, /const getFreshSession = useCallback/);
  assert.match(app, /Number\(error\?\.status\) !== 401/);
  assert.match(app, /activeSession = await getFreshSession\(true\)/);
  assert.match(app, /window\.setInterval\(keepSessionFresh, 5 \* 60 \* 1000\)/);
  assert.match(app, /paymentMessage=\{paymentMessage\}/);
});

test("1.1.17 mantém toggles de módulos compactos no mobile e corrige checklist Hoje", async () => {
  const styles = await readFile(new URL("../src/styles/app.css", import.meta.url), "utf8");
  assert.match(app, /module-visibility-toggle/);
  assert.match(styles, /button\.module-visibility-toggle\[aria-label\][\s\S]*min-height:24px !important/);
  assert.match(app, /item\.id === "today"/);
  assert.match(app, /onboardingIntroCompleted: true/);
});

test("1.1.17 mostra todas as próximas contas automaticamente", () => {
  assert.match(financeView, /const upcomingBills = pendingFinanceBills[\s\S]*dueDate >= today\(\)\);/);
  assert.match(financeView, /\[\.\.\.overdueBills, \.\.\.upcomingBills\]\.map/);
  assert.doesNotMatch(financeView, /showAllBills/);
  assert.doesNotMatch(financeView, /\{showAllBills \? "Ocultar" : "Gerenciar"\}/);
});

test("1.1.17 aplica limites Free de finanças, metas e dieta no app e backend", async () => {
  const plans = await readFile(new URL("../src/lib/plans.js", import.meta.url), "utf8");
  const domainSync = await readFile(new URL("../supabase/functions/domain-sync/index.ts", import.meta.url), "utf8");
  assert.match(plans, /activeGoals:\s*1/);
  assert.match(plans, /financeTransactions:\s*8/);
  assert.match(plans, /dietItemsPerMeal:\s*2/);
  assert.match(financeView, /\{transactions\.length\}\/\{PRO_LIMITS\.financeTransactions\} lançamentos Free/);
  assert.match(app, /\{group\.items\.length\}\/\{PRO_LIMITS\.dietItemsPerMeal\} alimentos Free/);
  assert.match(domainSync, /activeGoals:\s*1/);
  assert.match(domainSync, /financeTransactions:\s*8/);
  assert.match(domainSync, /dietItemsPerMeal:\s*2/);
  assert.match(domainSync, /free_limit_finance_transactions/);
  assert.match(domainSync, /free_limit_diet_items_per_meal/);
});

test("1.1.19 exige horário em novas tarefas e fixa lembrete em 30 minutos", async () => {
  const app = await readFile(new URL("../App.jsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../index.css", import.meta.url), "utf8");
  const domainSync = await readFile(new URL("../supabase/functions/domain-sync/index.ts", import.meta.url), "utf8");

  assert.match(app, /Horário obrigatório/);
  assert.match(app, /reminderMinutes:\s*30/);
  assert.match(app, /disabled=\{!title\.trim\(\) \|\| !taskTime/);
  assert.doesNotMatch(app, /Horário \(opcional\)/);
  assert.match(css, /task-time-icon/);
  assert.match(css, /#FFFFFF/);
  assert.match(domainSync, /validateNewTaskTimes/);
  assert.match(domainSync, /task_time_required/);
});

test("1.1.19 envia detalhes da tarefa 30 minutos antes também no Free", async () => {
  const notifications = await readFile(new URL("../supabase/functions/send-due-notifications/index.ts", import.meta.url), "utf8");
  const notificationUi = await readFile(new URL("../src/features/notifications/NotificationsView.jsx", import.meta.url), "utf8");

  assert.match(notifications, /const reminderMinutes = 30/);
  assert.match(notifications, /taskNotificationBody/);
  assert.match(notifications, /Em 30 min/);
  assert.doesNotMatch(notifications, /if \(!isProUser\) continue/);
  assert.match(notificationUi, /lembrete automático 30 minutos antes/);
  assert.match(notificationUi, /também funciona no plano Free/);
});


test("1.1.20 mantém seletor de horário responsivo no mobile", async () => {
  const css = await readFile(new URL("../index.css", import.meta.url), "utf8");
  assert.match(css, /1\.1\.20 — campo de horário responsivo/);
  assert.match(css, /\.task-time-field\s*\{[\s\S]*max-width:\s*100%/);
  assert.match(css, /\.task-time-input\s*\{[\s\S]*min-width:\s*0/);
  assert.match(css, /-webkit-appearance:\s*none/);
  assert.match(css, /font-size:\s*16px/);
  assert.match(app, /color="#FFFFFF"/);
});

test("1.1.20+ sincronização continua cloud-first e agora usa revisão atômica v3", async () => {
  const domainSync = await readFile(new URL("../supabase/functions/domain-sync/index.ts", import.meta.url), "utf8");
  assert.match(app, /a nuvem é a fonte principal ao entrar em outro dispositivo/i);
  assert.match(app, /pullRemoteState/);
  assert.match(app, /baseFieldRevisions/);
  assert.match(app, /sync_conflict/);
  assert.match(app, /pullRemoteState\(\{ preservePending: false \}\)/);
  assert.match(domainSync, /req\.method === "GET"/);
  assert.match(domainSync, /constancce_apply_sync_patch/);
  assert.match(domainSync, /baseFieldRevisions/);
  assert.match(domainSync, /sync_conflict/);
  assert.match(domainSync, /status: 409/);
});

test("1.1.21+ mantém fila durável após refresh e preserva base de reconciliação", async () => {
  const syncV3 = await readFile(new URL("../src/lib/syncV3.js", import.meta.url), "utf8");
  assert.match(app, /constancce_pending_sync_/);
  assert.match(app, /loadPendingSync/);
  assert.match(app, /savePendingSync/);
  assert.match(app, /clearPendingSync/);
  assert.match(app, /baseData/);
  assert.match(app, /baseFieldRevisions/);
  assert.match(app, /mutationId/);
  assert.match(app, /Autosave de segurança/);
  assert.match(syncV3, /mergePendingPayloadV3/);
  assert.match(syncV3, /mergeRemoteWithPendingV3/);
  assert.match(syncV3, /rebasePendingV3/);
});

test("1.1.23 usa estado canônico com revisão, ledger idempotente e mirror legado", async () => {
  const domainSync = await readFile(new URL("../supabase/functions/domain-sync/index.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../SUPABASE_SYNC_V3_1_1_23.sql", import.meta.url), "utf8");
  assert.match(domainSync, /constancce_sync_state/);
  assert.match(domainSync, /constancce_apply_sync_patch/);
  assert.match(domainSync, /protocolVersion: 3/);
  assert.match(domainSync, /legacyMirror/);
  assert.match(migration, /constancce_sync_mutations/);
  assert.match(migration, /for update/);
  assert.match(migration, /mutation_id/);
  assert.match(migration, /field_revisions/);
});

test("1.1.22 aceita origens oficiais e atualiza segundo dispositivo rapidamente", async () => {
  const security = await readFile(new URL("../supabase/functions/_shared/security.ts", import.meta.url), "utf8");
  assert.match(security, /https:\/\/constancceapp\.com/);
  assert.match(security, /https:\/\/app\.constancceapp\.com/);
  assert.match(security, /https:\/\/constancce-app\.vercel\.app/);
  assert.match(security, /GET, POST, OPTIONS/);
  assert.match(app, /}, 3000\);/);
  assert.match(app, /}, 30000\);/);
  assert.match(app, /window\.addEventListener\("focus", refreshWhenActive\)/);
  assert.match(app, /window\.addEventListener\("pageshow", refreshWhenActive\)/);
});

test("1.1.23 pagehide não substitui cache completo por payload parcial", () => {
  assert.match(app, /localBeforeLeave = migrateUserData\(\{[\s\S]*loadUserLocalData\(session\.user\.id\)[\s\S]*\.\.\.latest/);
  assert.doesNotMatch(app, /const latest = pending\.data;\s*saveUserLocalData\(session\.user\.id, latest\)/);
});

test("sincronização expõe falhas por camada sem confundir Tarefas com outros módulos", () => {
  assert.match(app, /taskSyncStatus === "error"/);
  assert.match(app, /Tarefas ainda não confirmadas na nuvem/);
  assert.match(app, /genericHasPending \? "Outros dados aguardam confirmação" : "Não foi possível verificar outros dados agora"/);
  assert.match(app, /syncStatus === "error" && genericHasPending/);
  assert.match(app, /syncStatus === "error" && !genericHasPending/);
});

test("1.1.27 não trata falha de leitura como alteração pendente quando a fila está vazia", () => {
  assert.match(app, /pendingSyncRef\.current \? "error" : "idle"/);
  assert.match(app, /Não há alterações locais pendentes\. A verificação dos outros módulos não pôde ser concluída agora\./);
  assert.match(app, /genericHasPending=\{Boolean\(pendingSyncRef\.current\)\}/);
});

test("1.1.24 preserva o mecanismo atômico histórico por item", async () => {
  const taskSyncV4 = await readFile(new URL("../src/lib/taskSyncV4.js", import.meta.url), "utf8");
  const domainSync = await readFile(new URL("../supabase/functions/domain-sync/index.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../supabase/sql/SUPABASE_TASK_SYNC_V4_1_1_24.sql", import.meta.url), "utf8");
  assert.match(taskSyncV4, /buildTaskOpsV4/);
  assert.match(domainSync, /constancce_tasks/);
  assert.match(domainSync, /constancce_apply_task_ops/);
  assert.match(domainSync, /taskRevisions/);
  assert.match(domainSync, /protocolVersion:\s*4/);
  assert.match(migration, /primary key \(user_id, task_id\)/i);
  assert.match(migration, /deleted_at/);
  assert.match(migration, /pg_advisory_xact_lock/);
});

test("1.1.24 exclusões de tarefas usam tombstone e não ressuscitam por cliente stale", async () => {
  const migration = await readFile(new URL("../supabase/sql/SUPABASE_TASK_SYNC_V4_1_1_24.sql", import.meta.url), "utf8");
  assert.match(migration, /Exclusão explícita é definitiva/);
  assert.match(migration, /deleted_remotely/);
  assert.match(migration, /revision_conflict/);
  assert.match(migration, /deleted_at = v_now/);
});

test("1.1.24 tarefas usam Realtime como gatilho e polling apenas como fallback", async () => {
  const app24 = await readFile(new URL("../App.jsx", import.meta.url), "utf8");
  const migration = await readFile(new URL("../supabase/sql/SUPABASE_TASK_SYNC_V4_1_1_24.sql", import.meta.url), "utf8");
  assert.match(app24, /createSupabaseRealtimeClient/);
  assert.match(app24, /postgres_changes/);
  assert.match(app24, /table:\s*"constancce_tasks"/);
  assert.match(app24, /pullTaskState\(\{ preservePending: true \}\)/);
  assert.match(migration, /grant select on table public\.constancce_tasks to authenticated/i);
  assert.match(migration, /auth\.uid\(\) = user_id/);
  assert.match(migration, /alter publication supabase_realtime add table public\.constancce_tasks/i);
});


test("1.1.26 tarefas usam outbox por item e RPC individual, sem array inteiro", async () => {
  const app26 = await readFile(new URL("../App.jsx", import.meta.url), "utf8");
  const migration26 = await readFile(new URL("../SUPABASE_TASK_SYNC_V6_1_1_26.sql", import.meta.url), "utf8");
  const taskSyncV6 = await readFile(new URL("../src/lib/taskSyncV6.js", import.meta.url), "utf8");
  assert.match(app26, /rest\/v1\/rpc\/constancce_apply_my_task_op/);
  assert.match(app26, /taskOutboxRef/);
  assert.match(app26, /queueTaskMutation/);
  assert.match(app26, /commitTaskMutation/);
  assert.doesNotMatch(app26, /const queueTaskSync/);
  assert.match(taskSyncV6, /compactTaskOutbox/);
  assert.match(taskSyncV6, /applyTaskOutbox/);
  assert.match(migration26, /auth\.uid\(\)/);
  assert.match(migration26, /constancce_apply_my_task_op/);
  assert.match(migration26, /notify pgrst, 'reload schema'/);
  assert.match(migration26, /task_time_required/);
  assert.match(migration26, /free_limit_tasks/);
});

test("1.1.28 Hábitos e Treinos usam persistência atômica sem alterar Task Sync V6", async () => {
  const app28 = await readFile(new URL("../App.jsx", import.meta.url), "utf8");
  const routine = await readFile(new URL("../src/lib/routineSyncV1.js", import.meta.url), "utf8");
  const sql = await readFile(new URL("../SUPABASE_ROUTINE_SYNC_V1_1_1_28.sql", import.meta.url), "utf8");
  const task = await readFile(new URL("../src/lib/taskSyncV6.js", import.meta.url), "utf8");

  assert.match(app28, /rest\/v1\/rpc\/constancce_apply_my_entity_op/);
  assert.match(app28, /table:\s*"constancce_sync_entities"/);
  assert.match(app28, /routineOutboxRef/);
  assert.match(app28, /pullRoutineState/);
  assert.match(app28, /flushRoutineSync/);
  assert.match(app28, /!ROUTINE_FIELDS\.includes\(key\)/);
  assert.match(sql, /constancce_sync_entities/);
  assert.match(sql, /constancce_apply_my_entity_op/);
  assert.match(sql, /habit_completion/);
  assert.match(sql, /workout_session/);
  assert.match(sql, /alter publication supabase_realtime add table public\.constancce_sync_entities/i);
  assert.match(routine, /mergeWorkoutSession/);
  assert.match(task, /compactTaskOutbox/);
});

test("taskIsOverdue é centralizado e usado por Tarefas e pelo Calendário", () => {
  const definitions = app.match(/function taskIsOverdue\(/g) || [];
  assert.equal(definitions.length, 1);

  const tasksViewStart = app.indexOf("function TasksView(");
  const tasksViewEnd = app.indexOf("function calendarWorkoutCountForDate(");
  assert.ok(tasksViewStart > -1 && tasksViewEnd > tasksViewStart);
  const tasksViewSlice = app.slice(tasksViewStart, tasksViewEnd);
  assert.match(tasksViewSlice, /taskIsOverdue\(task, t\)/);

  const calendarSnapshotStart = app.indexOf("function calendarIntelligenceSnapshot(");
  const calendarSnapshotEnd = app.indexOf("function CalendarIntelligencePanel(");
  assert.ok(calendarSnapshotStart > -1 && calendarSnapshotEnd > calendarSnapshotStart);
  const calendarSnapshotSlice = app.slice(calendarSnapshotStart, calendarSnapshotEnd);
  assert.match(calendarSnapshotSlice, /taskIsOverdue\(task, today\(\)\)/);
});

test("Dashboard escolhe a próxima tarefa com a mesma prioridade da tela Tarefas", () => {
  const dashboardStart = app.indexOf("function Dashboard(");
  const dashboardEnd = app.indexOf("\nfunction ", dashboardStart + 1);
  assert.ok(dashboardStart > -1 && dashboardEnd > dashboardStart);
  const dashboardSlice = app.slice(dashboardStart, dashboardEnd);
  assert.match(dashboardSlice, /const nextTask = \[\.\.\.tasksToday\]\.sort\(\(a, b\) => taskPriorityScore\(b, t\) - taskPriorityScore\(a, t\)\)\[0\];/);
  assert.doesNotMatch(dashboardSlice, /const nextTask = tasksToday\[0\];/);
});

test("cronômetro de descanso: início, hidratação e ajuste manual usam o mesmo teto mínimo/máximo", () => {
  assert.match(restTimerHook, /const MIN_REST_SECONDS = 10;/);
  assert.match(restTimerHook, /const MAX_REST_SECONDS = 300;/);
  assert.match(restTimerHook, /const total = Math\.max\(MIN_REST_SECONDS, Math\.min\(MAX_REST_SECONDS, Number\(value\.total\) \|\| 90\)\);/);
  assert.match(restTimerHook, /const start = useCallback\(\(seconds = 90, metadata = \{\}\) => \{\s*const total = Math\.max\(MIN_REST_SECONDS, Math\.min\(MAX_REST_SECONDS, Number\(seconds\) \|\| 90\)\);/);
  assert.match(restTimerHook, /const adjust = useCallback\(\(deltaSeconds\) => \{/);
  assert.match(restTimerHook, /const total = Math\.max\(MIN_REST_SECONDS, Math\.min\(MAX_REST_SECONDS, current\.total \+ deltaSeconds\)\);/);
  assert.match(restTimerHook, /Math\.min\(current\.startedAt \+ MAX_REST_SECONDS \* 1000, current\.endAt \+ deltaSeconds \* 1000\)/);
});

test("cronômetro de descanso: fim do tempo vibra o dispositivo, sem tocar som", () => {
  assert.match(restTimerHook, /navigator\.vibrate\(\[180, 80, 180\]\);/);
  assert.doesNotMatch(restTimerHook, /AudioContext/);
});

test("Relatórios: progresso de metas não gera NaN/Infinity com meta zerada ou negativa", () => {
  assert.match(reportsView, /const target = Math\.max\(0, Number\(g\.target \|\| 0\)\);/);
  assert.match(reportsView, /const pct = target > 0 \? Math\.min\(100, Math\.max\(0, Math\.round\(\(current \/ target\) \* 100\)\)\) : 0;/);
});

test("PR de treino não é recalculado no render, usa o Set já derivado de sessionPrs", () => {
  const exerciseMapStart = workoutsView.indexOf("{activeTemplate.exercises.map((exercise, exerciseIndex) => {");
  const exerciseMapEnd = workoutsView.indexOf("\n            })}", exerciseMapStart);
  assert.ok(exerciseMapStart > -1 && exerciseMapEnd > exerciseMapStart);
  const exerciseMapSlice = workoutsView.slice(exerciseMapStart, exerciseMapEnd);

  assert.match(exerciseMapSlice, /const isPr = sessionPrExerciseIds\.has\(exercise\.id\);/);
  assert.doesNotMatch(exerciseMapSlice, /workoutHistoricalMaxLoad\(/);

  assert.match(workoutsView, /const sessionPrs = activeSession && activeTemplate[\s\S]{0,200}workoutHistoricalMaxLoad\(/);
  assert.match(workoutsView, /const sessionPrExerciseIds = useMemo\(\s*\(\) => new Set\(sessionPrs\.map\(\(exercise\) => exercise\.id\)\),\s*\[sessionPrs\]\s*\);/);
});

test("puxar treino de ontem desliza a rotação de treinos (workoutScheduleOffsetDays)", () => {
  // workoutEffectiveWeekday é usado em Hoje/Calendário (que ficam em App.jsx) e em
  // Treinos (extraído pra arquivo próprio) — precisa existir idêntico nos dois,
  // já que WorkoutsView.jsx mantém uma cópia local pra não criar import circular.
  assert.match(app, /function workoutEffectiveWeekday\(dateStr, offsetDays\) \{/);
  assert.match(workoutsView, /function workoutEffectiveWeekday\(dateStr, offsetDays\) \{/);
  assert.match(workoutsView, /const pullYesterdayWorkout = \(template\) => \{\s*(?:\/\/[^\n]*\n\s*)*if \(pullingWorkoutRef\.current\) return;/);
  assert.match(workoutsView, /workoutScheduleOffsetDays: Number\(current\?\.workoutScheduleOffsetDays \|\| 0\) \+ 1,/);
  // Duplo toque acidental não deve incrementar o offset duas vezes.
  assert.match(workoutsView, /pullingWorkoutRef\.current = true;\s*window\.setTimeout\(\(\) => \{ pullingWorkoutRef\.current = false; \}, 1000\);/);

  assert.match(workoutsView, /scheduledToday = templates\.filter\(\(template\) =>\s*\(template\.scheduleDays \|\| \[\]\)\.includes\(workoutEffectiveWeekday\(t, workoutScheduleOffsetDays\)\)/);
  assert.match(workoutsView, /yesterdayMissed = templates\.filter\(\(template\) =>\s*\(template\.scheduleDays \|\| \[\]\)\.includes\(workoutEffectiveWeekday\(yesterday, workoutScheduleOffsetDays\)\)/);
});

test("pull pós-flush de hábitos/tarefas preserva alteração feita durante o próprio round-trip", () => {
  const routineFlushStart = app.indexOf("const flushRoutineSync = useCallback(async () => {");
  const routineFlushEnd = app.indexOf("\n  }, [session, getFreshSession, pullRoutineState]);", routineFlushStart);
  assert.ok(routineFlushStart > -1 && routineFlushEnd > routineFlushStart);
  const routineFlushSlice = app.slice(routineFlushStart, routineFlushEnd);
  assert.match(routineFlushSlice, /clearRoutineOutbox\(session\.user\.id\);\s*(?:\/\/[^\n]*\n\s*)*return await pullRoutineState\(\{ preservePending: true \}\);/);
  assert.doesNotMatch(routineFlushSlice, /return await pullRoutineState\(\{ preservePending: false \}\);/);

  const taskFlushStart = app.indexOf("const flushTaskSync = useCallback(async () => {");
  const taskFlushEnd = app.indexOf("\n  }, [session, getFreshSession, pullTaskState, fireToast]);", taskFlushStart);
  assert.ok(taskFlushStart > -1 && taskFlushEnd > taskFlushStart);
  const taskFlushSlice = app.slice(taskFlushStart, taskFlushEnd);
  assert.match(taskFlushSlice, /clearTaskOutbox\(session\.user\.id\);\s*(?:\/\/[^\n]*\n\s*)*const pulled = await pullTaskState\(\{ preservePending: true \}\);/);
  assert.doesNotMatch(taskFlushSlice, /const pulled = await pullTaskState\(\{ preservePending: false \}\);/);
});

test("foguinho de hábitos conta hábitos criados antes de countsForStreak existir", () => {
  // Hábitos antigos nunca tiveram esse campo migrado (countsForStreak: undefined).
  // O formulário de criação já trata "não definido" como "conta" (initial?.countsForStreak ?? true,
  // App.jsx:2969) — o cálculo do streak precisa tratar do mesmo jeito, senão hábitos antigos ficam
  // de fora do streakHabits e o streak trava em 0 pra sempre, mesmo com hábitos sendo concluídos.
  assert.match(app, /const required = habits\.filter\(\(h\) => h\.countsForStreak !== false && habitValidOnDate\(h, dateStr, completions\)\);/);
  assert.match(app, /const streakHabits = habits\.filter\(\(habit\) => habit\.countsForStreak !== false\);/);
  assert.doesNotMatch(app, /habits\.filter\(\(h(?:abit)?\) => h(?:abit)?\.countsForStreak\)/);
});

test("foguinho de hábitos: habitValidOnDate e toggleActive tratam active indefinido como ativo", () => {
  // Mesma lacuna de migração do countsForStreak, mas no campo active: hábitos antigos nunca
  // tiveram esse campo definido (active: undefined). habitValidOnDate usava uma checagem de
  // verdade (!habit.active) que trata undefined como pausado — travando o streak em 0 pra
  // sempre, já que nenhum hábito antigo nunca é considerado "válido" em nenhum dia. Todo o
  // resto do app (ex.: activeHabits, App.jsx:3068/6617) já usa active !== false.
  assert.match(app, /function habitValidOnDate\(habit, dateStr, completions = \[\]\) \{\s*if \(habit\.active === false\) return false;/);
  assert.doesNotMatch(app, /if \(!habit\.active\) return false;/);

  // toggleActive também tratava undefined incorretamente: !undefined é true, então pausar um
  // hábito antigo (active: undefined) resultava em active:true — ou seja, o botão "Pausar" não
  // pausava. Corrigido para active: h.active === false (só reativa se já estava explicitamente
  // pausado; qualquer outro valor, incluindo undefined, pausa).
  assert.match(app, /const toggleActive = \(id\) => setHabits\(\(prev\) => \{ const next = prev\.map\(\(h\) => h\.id === id \? \{ \.\.\.h, active: h\.active === false, pausedAt: h\.active !== false \? today\(\) : h\.pausedAt, resumedAt: h\.active === false \? today\(\) : h\.resumedAt \} : h\); persist\(\{ habits: next \}\); return next; \}\);/);
});

test("Tarefas: planejamento semanal aceita arrastar tarefa por toque, não só por mouse", () => {
  // draggable/onDragStart é HTML5 DnD nativo, que só responde a mouse — toque nunca disparava
  // isso em nenhum navegador. Adiciona um long-press manual (touchstart/touchmove/touchend) que
  // reaproveita o mesmo draggedTaskId/weekDragTarget/scheduleTask já usados pelo fluxo de mouse.
  const plannerStart = app.indexOf('{section === "planning" && (');
  assert.ok(plannerStart > -1, "seção de planejamento não encontrada");
  const plannerEnd = app.indexOf("\n      )}", plannerStart);
  const plannerSlice = app.slice(plannerStart, plannerEnd);

  assert.match(plannerSlice, /data-planner-date=\{dateStr\}/);
  assert.match(plannerSlice, /onTouchStart=\{\(event\) => \{/);
  assert.match(plannerSlice, /onTouchMove=\{\(event\) => \{/);
  assert.match(plannerSlice, /onTouchEnd=\{\(event\) => \{/);
  assert.match(plannerSlice, /document\.elementFromPoint\(touch\.clientX, touch\.clientY\)/);
  assert.match(plannerSlice, /scheduleTask\(draggedTask, dropDate, false\)/);

  // scheduleTask reabre status "concluida" pra "pendente" ao mudar a data — arrastar uma
  // tarefa já feita (mouse ou toque) não pode ser permitido, senão reorganizar a semana
  // desfaz a conclusão sem querer.
  assert.match(plannerSlice, /draggable=\{!isRecurringTask\(task\) && task\.status !== "concluida"\}/);
  assert.match(plannerSlice, /if \(isRecurringTask\(task\) \|\| task\.status === "concluida"\) return;/);
  assert.match(plannerSlice, /if \(draggedTask && !isRecurringTask\(draggedTask\) && draggedTask\.status !== "concluida"\) scheduleTask/);
  assert.match(plannerSlice, /onTouchCancel=\{\(\) => \{/);
});

test("Metas: adicionar etapa não converte silenciosamente meta financeira\\/numérica em checklist", () => {
  const goalFormStart = app.indexOf("function GoalForm({");
  const goalFormEnd = app.indexOf("\nfunction GoalAddValue", goalFormStart);
  assert.ok(goalFormStart > -1 && goalFormEnd > goalFormStart, "GoalForm não encontrado");
  const goalFormSlice = app.slice(goalFormStart, goalFormEnd);

  // "checklist" agora é uma escolha explícita do seletor de tipo, não um efeito colateral
  // de digitar numa etapa — antes, qualquer "Etapa" preenchida convertia a meta (perdendo
  // valor acumulado, prazo e marcos configurados) mesmo que o tipo selecionado fosse outro.
  assert.match(goalFormSlice, /const isChecklist = type === "checklist";/);
  assert.match(goalFormSlice, /<option value="checklist">Etapas \(checklist\)<\/option>/);
  assert.doesNotMatch(goalFormSlice, /type: cleanChecklist\.length \? "checklist" : type,/);
  assert.match(goalFormSlice, /type,\s*target: savedTarget,/);
  assert.match(goalFormSlice, /const savedCurrent = isChecklist \? checklistCurrent : Math\.max\(0, Number\(current\) \|\| 0\);/);
});

test("Sincronização: reconciliar conflito de tarefa/hábito não sobrescreve edição mais nova feita durante o await", () => {
  const taskFlushStart = app.indexOf("const flushTaskSync = useCallback(async () => {");
  const taskFlushEnd = app.indexOf("\n  }, [session, getFreshSession, pullTaskState, fireToast]);", taskFlushStart);
  assert.ok(taskFlushStart > -1 && taskFlushEnd > taskFlushStart);
  const taskFlushSlice = app.slice(taskFlushStart, taskFlushEnd);
  // replacePendingOp só comparava por id — se uma edição mais nova da mesma tarefa entrasse
  // na fila durante o fetch de reconciliação, a versão antiga (pré-conflito) a sobrescrevia.
  assert.match(taskFlushSlice, /const supersededMeanwhile = !compactTaskOutbox\(taskOutboxRef\.current \|\| \[\]\)/);
  assert.match(taskFlushSlice, /if \(supersededMeanwhile\) continue;/);

  const routineFlushStart = app.indexOf("const flushRoutineSync = useCallback(async () => {");
  const routineFlushEnd = app.indexOf("\n  }, [session, getFreshSession, pullRoutineState]);", routineFlushStart);
  assert.ok(routineFlushStart > -1 && routineFlushEnd > routineFlushStart);
  const routineFlushSlice = app.slice(routineFlushStart, routineFlushEnd);
  assert.match(routineFlushSlice, /const supersededMeanwhile = !compactRoutineOutbox\(routineOutboxRef\.current \|\| \[\]\)/);
  assert.match(routineFlushSlice, /if \(supersededMeanwhile\) continue;/);
});

test("Sincronização: poll de segurança não ignora hábito\\/tarefa ainda não confirmado pelo servidor", () => {
  // As duas chamadas com preservePending:false (poll de 30s e volta de foco/aba) ignoravam
  // a fila de tarefas/hábitos ainda em voo, podendo fazer um item recém-marcado "voltar"
  // por alguns segundos até o próximo pull com preservePending:true corrigir sozinho.
  const guardOccurrences = app.match(/if \(taskOutboxRef\.current\?\.length \|\| routineOutboxRef\.current\?\.length\) return;/g) || [];
  assert.equal(guardOccurrences.length, 2);
});

test("Finanças: excluir lançamento de aporte para meta devolve o valor à meta", () => {
  assert.match(app, /const removeTransactionRecord = \(id\) => \{\s*setTransactions\(\(prev\) => \{\s*const removed = prev\.find\(\(t\) => t\.id === id\);/);
  assert.match(app, /if \(removed\?\.goalId && removed\.type === "saida" && removed\.category === "Aporte para meta"\) \{\s*addGoalProgress\(removed\.goalId, -Number\(removed\.value \|\| 0\)\);/);
});

test("Hoje: card de hábito com checklist não marca 100% direto no Dashboard", () => {
  // O Dashboard não tem habitChecklistLog/toggleHabitChecklist — marcar direto por lá deixava
  // a grade de Hábitos com o dia "concluído" sem nenhuma etapa registrada.
  assert.match(app, /const hasChecklist = Array\.isArray\(habit\.checklist\) && habit\.checklist\.length > 0;/);
  assert.match(app, /onClick=\{\(\) => \(hasChecklist \? setView\("habits"\) : toggleHabit\(habit\.id, t\)\)\}/);
});

test("Conquistas: galeria de marcos usa a prop unlocked (30 ACHIEVEMENT_DEFS ficam visíveis)", () => {
  const achievementsStart = app.indexOf("function AchievementsView({");
  const achievementsEnd = app.indexOf("\nfunction ChallengeForm", achievementsStart);
  assert.ok(achievementsStart > -1 && achievementsEnd > achievementsStart);
  const achievementsSlice = app.slice(achievementsStart, achievementsEnd);
  // Antes a tela só mostrava os 4 níveis de prêmio físico por streak — a prop `unlocked`
  // (os ~30 marcos que disparam toast) nunca era referenciada no componente.
  assert.match(achievementsSlice, /const unlockedBadgeIds = unlocked \|\| \[\];/);
  assert.match(achievementsSlice, /ACHIEVEMENT_DEFS\.reduce\(/);
  assert.match(achievementsSlice, /unlockedBadgeIds\.includes\(item\.id\)/);
});

test("SQL: remarcar hábito/checklist no mesmo dia não é tratado como conflito 'deleted_remotely'", async () => {
  const sql = await readFile(new URL("../supabase/sql/SUPABASE_ROUTINE_SYNC_V1_1_1_28.sql", import.meta.url), "utf8");
  const rootSql = await readFile(new URL("../SUPABASE_ROUTINE_SYNC_V1_1_1_28.sql", import.meta.url), "utf8");

  // habit_completion e habit_checklist usam chave composta determinística
  // (habitId:date / habitId:itemId:date), reaproveitada toda vez que o usuário
  // marca/desmarca a mesma caixinha no mesmo dia. Antes, upsert sobre uma linha
  // soft-deleted (desmarcada antes) sempre voltava conflito "deleted_remotely",
  // e o cliente descartava a marcação silenciosamente — o hábito "desmarcava
  // sozinho" segundos depois de marcado, porque a marcação nunca era salva.
  for (const content of [sql, rootSql]) {
    assert.match(content, /if v_current_deleted is not null and v_collection not in \('habit_completion', 'habit_checklist'\) then/);
    // A resurreição precisa continuar caindo no update normal (deleted_at = null),
    // não pode ganhar um branch próprio que esqueça de zerar deleted_at.
    const foundBlockStart = content.indexOf("if found then\n    -- habit_completion");
    const foundBlockEnd = content.indexOf("\n  else", foundBlockStart);
    assert.ok(foundBlockStart > -1 && foundBlockEnd > foundBlockStart, "bloco 'if found' do upsert não encontrado");
    const foundBlock = content.slice(foundBlockStart, foundBlockEnd);
    assert.match(foundBlock, /deleted_at = null,/);
  }
});

test("Treinos: trocar exercício busca carga anterior pelo nome, não pelo slot antigo", () => {
  const helperStart = workoutsView.indexOf("const workoutLoadHistoryByName = ");
  const helperEnd = workoutsView.indexOf("\nconst workoutHistoricalMaxLoad = ", helperStart);
  assert.ok(helperStart > -1 && helperEnd > helperStart, "workoutLoadHistoryByName não encontrada");
  const helperSlice = workoutsView.slice(helperStart, helperEnd);

  // Precisa varrer sessão × slot de CADA template (não só o template atual),
  // resolver o nome efetivo do slot (override ou nome original) e comparar
  // normalizado — só assim uma troca anterior pro mesmo exercício é encontrada.
  assert.match(helperSlice, /const target = normalizeWorkoutExerciseName\(exerciseName\);/);
  assert.match(helperSlice, /if \(!target\) return null;/);
  assert.match(helperSlice, /const effectiveName = session\.exerciseOverrides\?\.\[exercise\.id\] \|\| exercise\.name;/);
  assert.match(helperSlice, /normalizeWorkoutExerciseName\(effectiveName\) !== target/);

  const focusStart = workoutsView.indexOf("{activeTemplate.exercises.map((exercise, exerciseIndex) => {");
  const focusEnd = workoutsView.indexOf("\n            })}", focusStart);
  assert.ok(focusStart > -1 && focusEnd > focusStart, "loop de exercícios da sessão ativa não encontrado");
  const focusSlice = workoutsView.slice(focusStart, focusEnd);

  // Trocado (isSwapped): busca por nome, e SEM fallback pro exercise.load do
  // slot antigo — é exatamente esse fallback que fazia a carga/"Treino
  // anterior" mostrar o exercício errado depois de uma troca.
  assert.match(focusSlice, /const isSwapped = Boolean\(activeSession\.exerciseOverrides\?\.\[exercise\.id\]\);/);
  assert.match(focusSlice, /const previousLoad = isSwapped\s*\?\s*workoutLoadHistoryByName\(sessions, templates, displayName, activeSession\.date\)/);
  assert.match(focusSlice, /value=\{activeSession\.loads\?\.\[exercise\.id\] \?\? \(isSwapped \? \(previousLoad \?\? ""\) : \(exercise\.load \?\? ""\)\)\}/);
  assert.match(focusSlice, /\(!isSwapped && exercise\.load\)/);
});

test("Treinos: selecionar um treino da lista vira o treino de hoje, e 'Iniciar' só pré-visualiza (sem cronômetro)", () => {
  // openTodaySession não inicia mais a sessão de verdade (startOrGetSession) — só
  // agenda uma pré-visualização (plannedOnly, sem startedAt) via scheduleWorkoutSession
  // e troca pra aba "Hoje", substituindo o que estava lá.
  const openTodayStart = workoutsView.indexOf("const openTodaySession = (template) => {");
  const openTodayEnd = workoutsView.indexOf("\n  };", openTodayStart);
  assert.ok(openTodayStart > -1 && openTodayEnd > openTodayStart, "openTodaySession não encontrado");
  const openTodaySlice = workoutsView.slice(openTodayStart, openTodayEnd);
  assert.match(openTodaySlice, /setSection\("today"\);/);
  assert.match(openTodaySlice, /scheduleWorkoutSession\(template\.id, t, template\);/);
  assert.doesNotMatch(openTodaySlice, /startOrGetSession\(/);

  // workoutInProgress (cronômetro) e sessionNotStarted (pré-visualização) são
  // mutuamente exclusivos e dependem de activeSession.startedAt, não só de existir
  // uma sessão — uma sessão plannedOnly nunca tem startedAt.
  assert.match(workoutsView, /const workoutInProgress = Boolean\(activeSession && !activeSession\.completed && activeSession\.startedAt\);/);
  assert.match(workoutsView, /const sessionNotStarted = Boolean\(activeSession && !activeSession\.completed && !activeSession\.startedAt\);/);

  // O treino de hoje mostrado prioriza um treino já em andamento/concluído, depois
  // o selecionado manualmente na lista, e só por último cai no agendado automático.
  assert.match(workoutsView, /const activeOrDoneTodayTemplate = templates\.find\(\(template\) => \{/);
  assert.match(workoutsView, /const manuallySelectedTodayTemplate = !activeOrDoneTodayTemplate && activeTemplateId/);
  assert.match(workoutsView, /const primaryToday = activeOrDoneTodayTemplate \|\| manuallySelectedTodayTemplate \|\| scheduledToday\[0\] \|\| null;/);

  // Botão "Iniciar agora" chama startOrGetSession (o start de verdade, que marca
  // startedAt) só quando a sessão ainda é uma pré-visualização — precisa aparecer
  // tanto no resumo do topo quanto substituindo "Concluir treino" no rodapé.
  const iniciarAgoraMatches = workoutsView.match(/Iniciar agora/g) || [];
  assert.ok(iniciarAgoraMatches.length >= 2, "botão 'Iniciar agora' deveria aparecer pelo menos 2x (topo e rodapé)");
  assert.match(workoutsView, /\{sessionNotStarted && \(/);
  assert.match(workoutsView, /\) : sessionNotStarted \? \(/);
  assert.match(workoutsView, /onClick=\{\(\) => startOrGetSession\(activeTemplate\.id\)\}/);

  // Interações que só fazem sentido depois de confirmado (marcar série, marcar
  // exercício, avaliar esforço) ficam travadas enquanto for só pré-visualização.
  assert.match(workoutsView, /disabled=\{activeSession\.completed \|\| sessionNotStarted\}/);
});

test("Treinos/Finanças: extração pra arquivo próprio não deixou dependência sem import", () => {
  // Achados reais de um teste funcional em navegador (não só build/análise estática)
  // depois da extração de WorkoutsView/FinanceView pra arquivos próprios: várias
  // funções pequenas (definidas longe do bloco original em App.jsx) e dois
  // componentes usados também fora da tela (CalendarView) ficaram de fora da
  // primeira extração e só quebravam em runtime, nunca no build.
  assert.match(workoutsView, /function proCutoffDate\(days = PRO_LIMITS\.historyDays\) \{/);
  assert.match(workoutsView, /const startOfWeek = /);
  assert.match(workoutsView, /import \{ fetchProfessionalLinks, sendPrescription \} from "\.\.\/\.\.\/lib\/professionalLinks\.js";/);

  assert.match(financeView, /function smoothChartPath\(points\) \{/);
  assert.match(financeView, /const monthsUntilGoal = /);
  assert.match(financeView, /const monthlyGoalEstimate = /);

  // WorkoutTemplateForm e FinanceBillForm são usados tanto pela tela extraída
  // quanto por CalendarView (atalho "Criar novo treino"/"Nova conta" ao agendar
  // um dia), que continua em App.jsx — precisam viver em arquivo próprio
  // importado dos dois lados, não só dentro do arquivo lazy.
  assert.match(app, /import WorkoutTemplateForm from "\.\/src\/features\/workouts\/WorkoutTemplateForm\.jsx";/);
  assert.match(app, /import FinanceBillForm from "\.\/src\/features\/finance\/FinanceBillForm\.jsx";/);
  assert.match(app, /<WorkoutTemplateForm/);
  assert.match(app, /<FinanceBillForm/);
  assert.doesNotMatch(workoutsView, /^function WorkoutTemplateForm/m);
  assert.doesNotMatch(financeView, /^function FinanceBillForm/m);
  assert.match(workoutsView, /import WorkoutTemplateForm from "\.\/WorkoutTemplateForm\.jsx";/);
  assert.match(financeView, /import FinanceBillForm from "\.\/FinanceBillForm\.jsx";/);
});

test("Cor do app: usuário PRO pode escolher uma cor personalizada além dos 4 temas prontos", () => {
  // A cor customizada precisa ser validada (regex hex) antes de virar --brass, e o
  // --brass-dim é derivado via color-mix em vez de exigir uma segunda cor escolhida
  // manualmente pelo usuário — assim a UI fica com um único seletor de cor.
  assert.match(app, /const hasCustomAccentColor = \/\^#\[0-9a-fA-F\]\{6\}\$\/\.test\(profile\?\.customAccentColor \|\| ""\);/);
  assert.match(app, /const useCustomAccent = isPro && profile\?\.accentTheme === "custom" && hasCustomAccentColor;/);
  assert.match(app, /"--brass-dim": `color-mix\(in srgb, \$\{profile\.customAccentColor\} 60%, black\)`/);

  // Se accentTheme ficou "custom" mas a cor salva é inválida/ausente (perfil corrompido,
  // ou downgrade de plano), o app tem que cair pro preset "green" em vez de aplicar uma
  // classe CSS inexistente (accent-custom) que deixaria --brass sem override nenhum.
  assert.match(app, /const presetAccentTheme = isPro && profile\?\.accentTheme && profile\.accentTheme !== "custom" \? profile\.accentTheme : "green";/);
  assert.match(app, /const accentClass = useCustomAccent \? "" : `accent-\$\{presetAccentTheme\}`;/);

  // O estilo inline só é aplicado quando useCustomAccent é true, senão o app volta a
  // depender só da classe accent-* (mesmo mecanismo de antes, sem custom).
  assert.match(app, /style=\{accentStyle\}/);

  // Seletor de cor: um 5º swatch "Personalizada" com <input type="color"> nativo,
  // trancado por Pro do mesmo jeito que os outros 4 temas prontos.
  assert.match(app, /type="color"/);
  assert.match(app, /accentTheme: "custom", customAccentColor: e\.target\.value/);
});
