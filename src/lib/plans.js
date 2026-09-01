export const PRO_LIMITS = {
  habits: 5,
  activeTasks: 5,
  workouts: 2,
  activeGoals: 1,
  friends: 3,
  challenges: 1,
  historyDays: 30,
  dietFavorites: 5,
  dietSavedMeals: 2,
  customFoods: 8,
  financeTransactions: 8,
  dietItemsPerMeal: 2,
};

export const PRO_FEATURE_COPY = {
  habits: ["Hábitos ilimitados", "No Free você pode manter até 5 hábitos ativos."],
  tasks: ["Tarefas ilimitadas", "No Free você pode manter até 5 tarefas ativas."],
  workouts: ["Treinos ilimitados", "No Free você pode criar até 2 treinos."],
  goals: ["Metas ilimitadas", "No Free você pode manter até 1 meta ativa."],
  friends: ["Amigos ilimitados", "No Free você pode manter até 3 amigos."],
  history: ["Histórico completo", "No Free, o histórico detalhado fica limitado aos últimos 30 dias."],
  progress: ["Progresso avançado", "Compare 30, 90 e 365 dias e descubra tendências de longo prazo."],
  finance: ["Finanças avançadas", "No Free você pode manter até 8 lançamentos financeiros. Previsões, recorrências, contas a pagar, orçamentos e análises avançadas são PRO."],
  diet: ["Dieta avançada", "No Free você pode registrar até 2 alimentos por refeição do dia. Refeições salvas ampliadas, TMB e Nutrition Intelligence ficam disponíveis no PRO."],
  notifications: ["Notificações inteligentes", "O lembrete de tarefas 30 minutos antes está disponível no Free. Resumos horários e automações inteligentes são exclusivos do PRO."],
  personalization: ["Personalização PRO", "Temas exclusivos e ordem personalizada do menu fazem parte do PRO."],
  sharing: ["Compartilhar treinos", "Receber treinos é gratuito. Criar links e compartilhar seus próprios treinos é PRO."],
  reports: ["Relatórios avançados", "Resumo executivo e análises detalhadas do mês são recursos PRO."],
  prizes: ["Prêmios físicos", "As conquistas digitais são gratuitas. A solicitação dos prêmios físicos é exclusiva para membros PRO."],
  intelligence: ["Constancce Intelligence", "Insights automáticos sobre rotina, treino, metas e finanças são exclusivos do PRO."],
};

export function accessSummary(access) {
  if (!access) {
    return {
      isLifetime: false,
      isTrial: false,
      isPro: false,
      expired: false,
      daysRemaining: null,
      label: "Free",
      planLabel: "Constancce Free",
    };
  }

  const isLifetime = access.plan === "lifetime";
  if (isLifetime) {
    return {
      isLifetime: true,
      isTrial: false,
      isPro: true,
      expired: false,
      daysRemaining: null,
      label: "PRO Founder · Vitalício",
      planLabel: "Constancce PRO",
    };
  }

  const endMs = access.trial_ends_at ? new Date(access.trial_ends_at).getTime() : NaN;
  const isComplimentaryTrial =
    access.plan === "trial" && access.payment_status === "complimentary_trial";
  const expired = isComplimentaryTrial && Number.isFinite(endMs) ? Date.now() >= endMs : false;
  const daysRemaining = isComplimentaryTrial && Number.isFinite(endMs)
    ? Math.max(0, Math.ceil((endMs - Date.now()) / 86400000))
    : null;
  const isTrial = isComplimentaryTrial && Number.isFinite(endMs) && !expired;

  return {
    isLifetime: false,
    isTrial,
    isPro: isTrial,
    expired,
    daysRemaining,
    label: isTrial ? `PRO · Teste ${daysRemaining}d` : "Free",
    planLabel: isTrial ? "Constancce PRO — Teste" : "Constancce Free",
  };
}
