import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

type AnyObj = Record<string, any>;

function localClock(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(new Date());

  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";

  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    month: `${get("year")}-${get("month")}`,
    hour: Number(get("hour") || 0),
    minute: Number(get("minute") || 0),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")),
  };
}

function daysBetween(a: string, b: string) {
  return Math.round(
    (new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86400000
  );
}

function timeToMinutes(value: string) {
  const [hour, minute] = String(value || "").split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function cleanTaskText(value: unknown, max = 180) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function taskNotificationBody(task: AnyObj) {
  const priorityLabels: Record<string, string> = {
    baixa: "Prioridade baixa",
    media: "Prioridade média",
    alta: "Prioridade alta",
    urgente: "Urgente",
  };
  const categoryLabels: Record<string, string> = {
    saude: "Saúde",
    estudo: "Estudo",
    estudos: "Estudos",
    trabalho: "Trabalho",
    casa: "Casa",
    mente: "Mente",
    pessoal: "Pessoal",
    outro: "Outro",
    outros: "Outros",
  };

  const meta = [
    task?.taskTime ? `Horário ${task.taskTime}` : "",
    priorityLabels[String(task?.priority || "")] || "",
    categoryLabels[String(task?.category || "")] || cleanTaskText(task?.category, 40),
  ].filter(Boolean);

  const details = cleanTaskText(task?.description, 180);
  const estimate = Number(task?.estimatedMinutes || 0) > 0
    ? `Duração estimada: ${Number(task.estimatedMinutes)} min`
    : "";

  return [meta.join(" · "), details, estimate].filter(Boolean).join(". ");
}


function taskOccurs(task: AnyObj, date: string, weekday: number) {
  const start = task?.dueDate || task?.createdAt || date;
  if (date < start) return false;

  const repeat = task?.repeat || "none";

  if (repeat === "daily") return true;
  if (repeat === "weekly") return new Date(`${start}T12:00:00Z`).getUTCDay() === weekday;
  if (repeat === "monthly") return Number(date.slice(8, 10)) === Number(start.slice(8, 10));
  if (repeat === "custom") return (task?.repeatDays || []).includes(weekday);

  return task?.dueDate === date;
}

function taskDone(task: AnyObj, date: string) {
  const recurring = (task?.repeat || "none") !== "none";
  if (recurring) return (task?.completionDates || []).includes(date);
  return task?.status === "concluida";
}

function habitScheduled(
  habit: AnyObj,
  date: string,
  weekday: number,
  completions: AnyObj[],
) {
  if (!habit?.active) return false;
  if (habit?.createdAt && date < habit.createdAt) return false;

  const freq = habit?.frequency || { type: "daily" };

  if (freq.type === "daily") return true;
  if (freq.type === "weekdays") return (freq.days || []).includes(weekday);

  if (freq.type === "perweek") {
    const d = new Date(`${date}T12:00:00Z`);
    const diff = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - diff);
    const start = d.toISOString().slice(0, 10);

    const count = completions.filter(
      (c) => c.habitId === habit.id && c.date >= start && c.date <= date,
    ).length;

    return count < Number(freq.target || 1);
  }

  if (freq.type === "permonth") {
    const start = `${date.slice(0, 7)}-01`;

    const count = completions.filter(
      (c) => c.habitId === habit.id && c.date >= start && c.date <= date,
    ).length;

    return count < Number(freq.target || 1);
  }

  return true;
}

async function alreadySent(
  admin: any,
  subscriptionId: number,
  key: string,
) {
  const { data } = await admin
    .from("push_notification_log")
    .select("id")
    .eq("subscription_id", subscriptionId)
    .eq("notification_key", key)
    .maybeSingle();

  return Boolean(data);
}

async function markSent(
  admin: any,
  subscriptionId: number,
  userId: string,
  key: string,
) {
  await admin.from("push_notification_log").upsert({
    subscription_id: subscriptionId,
    user_id: userId,
    notification_key: key,
    sent_at: new Date().toISOString(),
  }, {
    onConflict: "subscription_id,notification_key",
  });
}

Deno.serve(async (req) => {
  const expectedSecret = Deno.env.get("PUSH_CRON_SECRET");
  const suppliedSecret = req.headers.get("x-cron-secret") || "";

  if (!expectedSecret || suppliedSecret !== expectedSecret) {
    return new Response("unauthorized", { status: 401 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject =
    Deno.env.get("VAPID_SUBJECT") || "mailto:admin@constancce.app";

  if (!vapidPublic || !vapidPrivate) {
    return new Response("VAPID not configured", { status: 500 });
  }

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  const admin = createClient(supabaseUrl, serviceRole);

  const { data: subscriptions, error: subscriptionError } = await admin
    .from("push_subscriptions")
    .select("*")
    .eq("enabled", true);

  if (subscriptionError) {
    console.error(subscriptionError);
    return new Response("subscription query failed", { status: 500 });
  }

  const userIds = [...new Set((subscriptions || []).map((s: AnyObj) => s.user_id))];

  if (!userIds.length) {
    return new Response(JSON.stringify({ sent: 0 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Durante a migração, o snapshot legado continua sendo apenas uma fonte de leitura.
  // Dados por domínio sempre sobrescrevem os campos equivalentes do device_sync.
  const [{ data: legacySyncRows }, { data: domainSyncRows, error: domainSyncError }] = await Promise.all([
    admin
      .from("device_sync")
      .select("user_id,data")
      .in("user_id", userIds),
    admin
      .from("constancce_domain_sync")
      .select("user_id,domain,data,updated_at")
      .in("user_id", userIds),
  ]);

  if (domainSyncError) {
    console.error("domain sync notification query error", domainSyncError);
  }

  const dataByUser = new Map<string, AnyObj>();

  for (const row of legacySyncRows || []) {
    dataByUser.set(row.user_id, { ...(row.data || {}) });
  }

  for (const row of domainSyncRows || []) {
    const current = dataByUser.get(row.user_id) || {};
    dataByUser.set(row.user_id, {
      ...current,
      ...(row.data || {}),
    });
  }

  // Tarefas e hábitos/treinos são sincronizados de forma atômica (por item) desde
  // a 1.1.26/1.1.28 e pararam de ser escritos no snapshot legado acima — usá-lo
  // para essas listas faz uma tarefa/hábito excluído continuar notificando para
  // sempre, porque ele nunca é removido de uma foto que não é mais atualizada.
  // Buscamos aqui as tabelas atômicas reais (fonte da verdade) e as usamos no
  // lugar do snapshot legado sempre que o usuário já tiver migrado para elas.
  const [{ data: atomicTaskRows, error: atomicTaskError }, { data: atomicEntityRows, error: atomicEntityError }] = await Promise.all([
    admin
      .from("constancce_tasks")
      .select("user_id,task_id,payload,deleted_at")
      .in("user_id", userIds),
    admin
      .from("constancce_sync_entities")
      .select("user_id,collection,entity_id,payload,deleted_at")
      .in("user_id", userIds)
      .in("collection", ["habit", "habit_completion", "workout_template", "workout_session"]),
  ]);

  if (atomicTaskError) console.error("atomic tasks notification query error", atomicTaskError);
  if (atomicEntityError) console.error("atomic entities notification query error", atomicEntityError);

  const usersWithAtomicTasks = new Set<string>();
  const atomicTasksByUser = new Map<string, AnyObj[]>();
  for (const row of atomicTaskRows || []) {
    usersWithAtomicTasks.add(row.user_id);
    if (row.deleted_at) continue;
    const list = atomicTasksByUser.get(row.user_id) || [];
    list.push(row.payload || {});
    atomicTasksByUser.set(row.user_id, list);
  }

  const ENTITY_FIELD_BY_COLLECTION: Record<string, string> = {
    habit: "habits",
    habit_completion: "completions",
    workout_template: "workoutTemplates",
    workout_session: "workoutSessions",
  };
  const usersWithAtomicEntities = new Set<string>();
  const atomicEntitiesByUser = new Map<string, Record<string, AnyObj[]>>();
  for (const row of atomicEntityRows || []) {
    usersWithAtomicEntities.add(row.user_id);
    if (row.deleted_at) continue;
    const field = ENTITY_FIELD_BY_COLLECTION[row.collection];
    if (!field) continue;
    const perUser = atomicEntitiesByUser.get(row.user_id) || {};
    const list = perUser[field] || [];
    list.push(row.payload || {});
    perUser[field] = list;
    atomicEntitiesByUser.set(row.user_id, perUser);
  }

  for (const userId of userIds) {
    const current = dataByUser.get(userId) || {};
    const next: AnyObj = { ...current };
    if (usersWithAtomicTasks.has(userId)) {
      next.tasks = atomicTasksByUser.get(userId) || [];
    }
    if (usersWithAtomicEntities.has(userId)) {
      const entities = atomicEntitiesByUser.get(userId) || {};
      next.habits = entities.habits || [];
      next.completions = entities.completions || [];
      next.workoutTemplates = entities.workoutTemplates || [];
      next.workoutSessions = entities.workoutSessions || [];
    }
    dataByUser.set(userId, next);
  }

  const { data: accessRows } = await admin
    .from("constancce_access")
    .select("user_id,plan,trial_ends_at,payment_status")
    .in("user_id", userIds);

  const accessByUser = new Map(
    (accessRows || []).map((row: AnyObj) => [row.user_id, row]),
  );

  let sent = 0;

  for (const sub of subscriptions || []) {
    const userData: AnyObj = dataByUser.get(sub.user_id) || {};
    const profile = userData.profile || {};
    const settings = profile.notificationSettings || {};
    const reminderIntensity = String(settings.reminderIntensity || "persistent");
    const clock = localClock(sub.timezone || profile.timezone || "UTC");

    const completions = userData.completions || [];
    const tasks = userData.tasks || [];
    const habits = userData.habits || [];
    const workouts = userData.workoutTemplates || [];
    const sessions = userData.workoutSessions || [];
    const goals = userData.goals || [];
    const transactions = userData.transactions || [];
    const foods = userData.foods || [];
    const mealLog = userData.mealLog || [];
    const financeBills = profile.financeBills || [];
    const access = accessByUser.get(sub.user_id) || {};
    const trialEnd = access.trial_ends_at ? new Date(access.trial_ends_at).getTime() : NaN;
    const isProUser = access.plan === "lifetime" ||
      (access.plan === "trial" &&
        access.payment_status === "complimentary_trial" &&
        Number.isFinite(trialEnd) &&
        Date.now() < trialEnd);

    const messages: {
      key: string;
      title: string;
      body: string;
      url: string;
      taskId?: string;
    }[] = [];

    // Resumo horário: no máximo uma notificação por hora e somente quando há algo pendente.
    if (isProUser && settings.hourlyReminders !== false && clock.hour >= 8 && clock.hour <= 22 && clock.minute < 16) {
      const pendingItems: string[] = [];

      const pendingTasksHourly = tasks.filter(
        (task: AnyObj) => taskOccurs(task, clock.date, clock.weekday) && !taskDone(task, clock.date),
      );
      if (settings.tasks !== false && pendingTasksHourly.length > 0) {
        pendingItems.push(`${pendingTasksHourly.length} tarefa${pendingTasksHourly.length === 1 ? "" : "s"}`);
      }

      const scheduledWorkoutsHourly = workouts.filter(
        (workout: AnyObj) => (workout.scheduleDays || []).includes(clock.weekday),
      );
      const workoutDoneHourly = sessions.some(
        (session: AnyObj) => session.date === clock.date && session.completed,
      );
      if (settings.workouts !== false && scheduledWorkoutsHourly.length > 0 && !workoutDoneHourly) {
        pendingItems.push("treino pendente");
      }

      const completedHabitIdsHourly = new Set(
        completions.filter((completion: AnyObj) => completion.date === clock.date).map((completion: AnyObj) => completion.habitId),
      );
      const pendingHabitsHourly = habits.filter(
        (habit: AnyObj) => habitScheduled(habit, clock.date, clock.weekday, completions) && !completedHabitIdsHourly.has(habit.id),
      );
      if (settings.habits !== false && pendingHabitsHourly.length > 0) {
        pendingItems.push(`${pendingHabitsHourly.length} hábito${pendingHabitsHourly.length === 1 ? "" : "s"}`);
      }

      const dietConfigured = foods.length > 0 || Number(profile.calorieTarget || 0) > 0;
      if (dietConfigured) {
        const todayMeals = mealLog.filter((meal: AnyObj) => meal.date === clock.date && meal.consumed !== false);
        const kcalToday = todayMeals.reduce((sum: number, meal: AnyObj) => sum + Number(meal.calories || 0), 0);
        const kcalTarget = Number(profile.calorieTarget || 0);
        const dietPending = kcalTarget > 0 ? kcalToday < kcalTarget : todayMeals.length < 3;
        if (dietPending) pendingItems.push("dieta pendente");
      }

      const unpaidBills = financeBills.filter((bill: AnyObj) => {
        if (bill.status === "pago" || !bill.dueDate) return false;
        return daysBetween(clock.date, bill.dueDate) <= 2;
      });
      if (settings.finance !== false && unpaidBills.length > 0) {
        pendingItems.push(`${unpaidBills.length} conta${unpaidBills.length === 1 ? "" : "s"} a pagar`);
      }

      if (pendingItems.length > 0) {
        messages.push({
          key: `hourly-pending:${clock.date}:${clock.hour}`,
          title: "Seu próximo passo",
          body: `Pendente agora: ${pendingItems.slice(0, 4).join(" · ")}.`,
          url: "/?view=dashboard",
        });
      }
    }

    if (settings.tasks !== false) {
      const pending = tasks.filter(
        (t: AnyObj) => taskOccurs(t, clock.date, clock.weekday) && !taskDone(t, clock.date),
      );

      const nowMinutes = clock.hour * 60 + clock.minute;

      for (const task of pending.filter((t: AnyObj) => Boolean(t.taskTime))) {
        const taskMinutes = timeToMinutes(task.taskTime);
        if (taskMinutes == null) continue;

        const snoozedUntil = task.snoozedUntil ? new Date(task.snoozedUntil) : null;
        if (snoozedUntil) {
          const snoozeDeltaMinutes = Math.floor((Date.now() - snoozedUntil.getTime()) / 60000);
          if (snoozedUntil.getTime() > Date.now()) continue;
          if (snoozeDeltaMinutes >= 0 && snoozeDeltaMinutes <= 16) {
            messages.push({
              key: `task-snooze:${task.id}:${task.snoozedUntil}`,
              title: "Tarefa pendente · adiada",
              body: `${cleanTaskText(task.title, 90) || "Tarefa"}. ${taskNotificationBody(task)}`.trim(),
              url: "/?view=tasks",
              taskId: task.id,
            });
          }
          continue;
        }

        // Regra universal do Constancce: toda tarefa com horário avisa 30 minutos antes.
        // O cron recomendado é a cada 5 minutos; a janela de 6 minutos evita perder
        // horários que não coincidem exatamente com o minuto do cron.
        const reminderMinutes = 30;
        const target = taskMinutes - reminderMinutes;
        const delta = nowMinutes - target;

        if (delta >= 0 && delta <= 6) {
          messages.push({
            key: `task-time:${task.id}:${clock.date}:${task.taskTime}:30`,
            title: `Em 30 min · ${cleanTaskText(task.title, 80) || "Tarefa programada"}`,
            body: taskNotificationBody(task) || "Abra o Constancce para ver os detalhes da tarefa.",
            url: "/?view=tasks",
            taskId: task.id,
          });
        }
      }

      // Tarefas com horário já vencido: lembrete a cada 1 hora, mantendo o minuto original da tarefa.
      // Ex.: tarefa 10:30 -> lembretes por volta de 11:30, 12:30, 13:30... até concluir/reagendar.
      if (isProUser && reminderIntensity !== "discreet" && clock.hour >= 8 && clock.hour <= 22) {
        const hourlyOverdueTasks = tasks.filter((task: AnyObj) => {
          if (!task?.taskTime) return false;
          if (task?.snoozedUntil && new Date(task.snoozedUntil).getTime() > Date.now()) return false;

          const recurring = (task.repeat || "none") !== "none";
          if (recurring) {
            return taskOccurs(task, clock.date, clock.weekday) && !taskDone(task, clock.date);
          }

          return task.status !== "concluida" && Boolean(task.dueDate) && task.dueDate <= clock.date;
        });

        for (const task of hourlyOverdueTasks) {
          const taskMinutes = timeToMinutes(task.taskTime);
          if (taskMinutes == null) continue;

          const recurring = (task.repeat || "none") !== "none";
          const occurrenceDate = recurring ? clock.date : task.dueDate;
          const daysLate = Math.max(0, daysBetween(occurrenceDate, clock.date));
          const totalMinutesLate = daysLate * 1440 + nowMinutes - taskMinutes;

          if (totalMinutesLate < 60) continue;

          // O cron roda a cada ~15 min; essa janela captura a execução mais próxima do minuto da tarefa.
          const minuteOffset = ((totalMinutesLate % 60) + 60) % 60;
          if (minuteOffset > 16) continue;

          const lateHours = Math.max(1, Math.floor(totalMinutesLate / 60));
          if (reminderIntensity === "balanced" && lateHours % 2 !== 0) continue;

          messages.push({
            key: `task-overdue-hourly:${task.id}:${occurrenceDate}:${lateHours}`,
            title: "Tarefa pendente · atrasada",
            body: `“${task.title || "Tarefa"}” passou do horário há ${lateHours}h. Conclua ou reagende.`,
            url: "/?view=tasks",
            taskId: task.id,
          });
        }
      }

      const genericPending = isProUser
        ? pending.filter((t: AnyObj) => !t.taskTime)
        : pending;

      if (genericPending.length && clock.hour >= 9) {
        messages.push({
          key: `tasks:${clock.date}`,
          title: "Tarefa pendente",
          body: isProUser
            ? `Você tem ${genericPending.length} tarefa${genericPending.length === 1 ? "" : "s"} sem horário ainda pendente${genericPending.length === 1 ? "" : "s"}.`
            : `Você tem ${genericPending.length} tarefa${genericPending.length === 1 ? "" : "s"} pendente${genericPending.length === 1 ? "" : "s"} hoje.`,
          url: "/?view=tasks",
        });
      }

      const overdue = tasks.filter(
        (t: AnyObj) =>
          (t.repeat || "none") === "none" &&
          t.status !== "concluida" &&
          t.dueDate &&
          t.dueDate < clock.date,
      );

      if (overdue.length && clock.hour >= 9) {
        messages.push({
          key: `overdue:${clock.date}`,
          title: "Tarefa pendente · atrasada",
          body: `${overdue.length} tarefa${overdue.length === 1 ? "" : "s"} precisa${overdue.length === 1 ? "" : "m"} da sua atenção.`,
          url: "/?view=tasks",
        });
      }
    }

    if (settings.workouts !== false && clock.hour >= 17 && workouts.length > 0) {
      const scheduled = workouts.filter(
        (workout: AnyObj) => !(workout.scheduleDays || []).length || (workout.scheduleDays || []).includes(clock.weekday),
      );
      const done = sessions.some(
        (s: AnyObj) => s.date === clock.date && s.completed,
      );

      if (!done && scheduled.length > 0) {
        messages.push({
          key: `workout:${clock.date}`,
          title: "Treino programado",
          body: scheduled[0]?.name ? `${scheduled[0].name} está programado para hoje.` : "Seu treino ainda está esperando por você hoje.",
          url: "/?view=workouts",
        });
      }
    }

    if (settings.habits !== false && clock.hour >= 18) {
      const completedIds = new Set(
        completions
          .filter((c: AnyObj) => c.date === clock.date)
          .map((c: AnyObj) => c.habitId),
      );

      const pendingHabits = habits.filter(
        (h: AnyObj) =>
          habitScheduled(h, clock.date, clock.weekday, completions) &&
          !completedIds.has(h.id),
      );

      if (pendingHabits.length) {
        messages.push({
          key: `habits:${clock.date}`,
          title: "Feche o dia com constância",
          body: `Ainda faltam ${pendingHabits.length} hábito${pendingHabits.length === 1 ? "" : "s"} para concluir hoje.`,
          url: "/?view=habits",
        });
      }
    }

    if (isProUser && settings.weeklyReview !== false && clock.weekday === 0 && clock.hour >= 18) {
      messages.push({
        key: `weekly-review:${clock.date}`,
        title: "Hora da revisão semanal",
        body: "Veja seu score, treinos, tarefas e escolha o foco dos próximos 7 dias.",
        url: "/?view=dashboard",
      });
    }

    if (settings.goals !== false && clock.hour >= 9) {
      const urgentGoals = goals.filter((g: AnyObj) => {
        if (g.completed || !g.endDate) return false;
        const left = daysBetween(clock.date, g.endDate);
        return left >= 0 && left <= 3;
      });

      for (const goal of urgentGoals.slice(0, 2)) {
        const left = daysBetween(clock.date, goal.endDate);

        messages.push({
          key: `goal:${goal.id}:${clock.date}`,
          title: "Meta próxima do prazo",
          body: `"${goal.name}" vence ${left === 0 ? "hoje" : `em ${left} dia${left === 1 ? "" : "s"}`}.`,
          url: "/?view=goals",
        });
      }
    }

    if (settings.finance !== false && clock.hour >= 10) {
      const monthStart = `${clock.month}-01`;
      const monthOut = transactions
        .filter((tx: AnyObj) => tx.type === "saida" && tx.date >= monthStart)
        .reduce((sum: number, tx: AnyObj) => sum + Number(tx.value || 0), 0);

      const limit = Number(profile.monthlyLimit || 3000);

      if (limit > 0 && monthOut > limit) {
        messages.push({
          key: `finance:${clock.month}`,
          title: "Limite financeiro ultrapassado",
          body: "Seus gastos do mês ultrapassaram o limite definido no Constancce.",
          url: "/?view=finance",
        });
      }

      const upcomingBills = isProUser ? (profile.financeBills || []).filter((bill: AnyObj) => {
        if (bill.status === "pago" || !bill.dueDate) return false;
        const left = daysBetween(clock.date, bill.dueDate);
        return left >= 0 && left <= 2;
      }) : [];

      for (const bill of upcomingBills.slice(0, 2)) {
        const left = daysBetween(clock.date, bill.dueDate);
        messages.push({
          key: `bill:${bill.id}:${clock.date}`,
          title: left === 0 ? "Conta vence hoje" : "Conta próxima do vencimento",
          body: `${bill.description || "Conta"} · ${left === 0 ? "vence hoje" : `vence em ${left} dia${left === 1 ? "" : "s"}`}.`,
          url: "/?view=finance",
        });
      }
    }

    for (const message of messages) {
      if (await alreadySent(admin, sub.id, message.key)) continue;

      try {
        await webpush.sendNotification(
          sub.subscription,
          JSON.stringify({
            title: message.title,
            body: message.body,
            icon: "/icon-192.png",
            badge: "/favicon-32x32.png",
            tag: message.key,
            url: message.url,
            taskId: message.taskId,
          }),
        );

        await markSent(admin, sub.id, sub.user_id, message.key);
        sent += 1;
      } catch (error: any) {
        const status = Number(error?.statusCode || 0);
        console.error(
          "push send error",
          status,
          error?.body || error?.message,
        );

        if (status === 404 || status === 410) {
          await admin
            .from("push_subscriptions")
            .update({ enabled: false })
            .eq("id", sub.id);
        }
      }
    }
  }

  const cutoff = new Date(Date.now() - 45 * 86400000).toISOString();
  await admin.from("push_notification_log").delete().lt("sent_at", cutoff);

  return new Response(JSON.stringify({ sent }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
