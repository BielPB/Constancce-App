import { createClient } from "npm:@supabase/supabase-js@2";
import { clientIdentity, consumeRateLimit, corsHeaders, getEnv, json, originAllowed, preflight, requireVerifiedUser } from "../_shared/security.ts";

const DOMAIN_FIELDS: Record<string, string[]> = {
  account: ["profile", "unlocked"],
  habits: ["habits", "completions", "habitChecklistLog"],
  tasks: ["tasks"],
  goals: ["goals", "goalProgressLog"],
  workouts: ["workoutTemplates", "workoutSessions"],
  diet: ["foods", "mealLog"],
  finance: ["transactions"],
};

const FREE_LIMITS = {
  habits: 5,
  activeTasks: 5,
  workouts: 2,
  activeGoals: 1,
  dietFavorites: 5,
  dietSavedMeals: 2,
  customFoods: 8,
  financeTransactions: 8,
  dietItemsPerMeal: 2,
};

const array = (value: unknown) => Array.isArray(value) ? value : [];

const domainsForKeys = (keys: string[]) => {
  const set = new Set(keys);
  return Object.entries(DOMAIN_FIELDS)
    .filter(([, fields]) => fields.some((field) => set.has(field)))
    .map(([domain]) => domain);
};

// Snapshot canônico completo da conta. Os rows por domínio continuam sendo a
// fonte para controle de conflito, enquanto device_sync mantém uma cópia integral
// para recuperação imediata em um segundo dispositivo e compatibilidade legada.
const canonicalSnapshot = (source: Record<string, any>) => {
  const result: Record<string, any> = {
    schemaVersion: Number(source?.schemaVersion || 0),
  };
  for (const fields of Object.values(DOMAIN_FIELDS)) {
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(source || {}, field)) result[field] = source[field];
    }
  }
  return result;
};

const countFreeUsage = (data: Record<string, any>) => {
  const profile = data?.profile || {};
  return {
    habits: array(data?.habits).filter((habit: any) => habit?.active !== false).length,
    activeTasks: array(data?.tasks).filter((task: any) =>
      (task?.repeat || "none") !== "none" || task?.status !== "concluida"
    ).length,
    workouts: array(data?.workoutTemplates).length,
    activeGoals: array(data?.goals).filter((goal: any) => !goal?.completed && !goal?.archived).length,
    dietFavorites: array(profile?.dietFavorites).length,
    dietSavedMeals: array(profile?.dietSavedMeals).length,
    customFoods: array(data?.foods).filter((food: any) => !food?.source || food?.source === "custom").length,
    financeTransactions: array(data?.transactions).length,
  };
};

const mealSlotCounts = (data: Record<string, any>) => {
  const counts = new Map<string, number>();
  for (const meal of array(data?.mealLog)) {
    const date = String(meal?.date || "").slice(0, 10);
    const mealType = String(meal?.mealType || "Café da manhã");
    if (!date) continue;
    const key = `${date}::${mealType}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
};

const validateFree = (
  incoming: Record<string, any>,
  baseline: Record<string, any>,
  domains: string[],
) => {
  const next = countFreeUsage(incoming);
  const current = countFreeUsage(baseline);
  const allowed = (key: keyof typeof FREE_LIMITS) =>
    Math.max(Number(FREE_LIMITS[key] || 0), Number(current[key] || 0));

  if (domains.includes("habits") && next.habits > allowed("habits")) return "free_limit_habits";
  if (domains.includes("tasks") && next.activeTasks > allowed("activeTasks")) return "free_limit_tasks";
  if (domains.includes("workouts") && next.workouts > allowed("workouts")) return "free_limit_workouts";
  if (domains.includes("goals") && next.activeGoals > allowed("activeGoals")) return "free_limit_goals";
  if (domains.includes("account") && next.dietFavorites > allowed("dietFavorites")) return "free_limit_diet_favorites";
  if (domains.includes("account") && next.dietSavedMeals > allowed("dietSavedMeals")) return "free_limit_saved_meals";
  if (domains.includes("diet") && next.customFoods > allowed("customFoods")) return "free_limit_custom_foods";
  if (domains.includes("finance") && next.financeTransactions > allowed("financeTransactions")) return "free_limit_finance_transactions";

  if (domains.includes("diet")) {
    const nextSlots = mealSlotCounts(incoming);
    const currentSlots = mealSlotCounts(baseline);
    for (const [slot, nextCount] of nextSlots.entries()) {
      const currentCount = currentSlots.get(slot) || 0;
      const slotAllowed = Math.max(FREE_LIMITS.dietItemsPerMeal, currentCount);
      if (nextCount > slotAllowed) return "free_limit_diet_items_per_meal";
    }
  }

  return null;
};

const validateNewTaskTimes = (
  incoming: Record<string, any>,
  baseline: Record<string, any>,
) => {
  const existingIds = new Set(
    array(baseline?.tasks)
      .map((task: any) => String(task?.id || ""))
      .filter(Boolean),
  );

  for (const task of array(incoming?.tasks)) {
    const taskId = String(task?.id || "");
    if (!taskId || existingIds.has(taskId)) continue;
    if (!/^\d{2}:\d{2}$/.test(String(task?.taskTime || ""))) {
      return "task_time_required";
    }
  }

  return null;
};

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const headers = corsHeaders(req);
  if (!originAllowed(req)) return json({ error: "origin_not_allowed" }, 403, headers);
  if (!["GET", "POST"].includes(req.method)) return json({ error: "method_not_allowed" }, 405, headers);

  try {
    const { supabaseUrl, serviceRole } = getEnv();
    const { user, error: authError } = await requireVerifiedUser(req);
    if (!user) return json({ error: authError }, authError === "email_not_confirmed" ? 403 : 401, headers);
    const admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });
    const allowed = await consumeRateLimit(admin, "domain-sync", clientIdentity(req, user.id), 300, 60);
    if (!allowed) return json({ error: "too_many_requests" }, 429, { ...headers, "Retry-After": "60" });

    const loadAtomicTasks = async (seedTasks: any[] = []) => {
      const { data: rows, error } = await admin
        .from("constancce_tasks")
        .select("task_id,payload,revision,deleted_at,updated_at")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: true });
      if (error) {
        const message = String(error.message || "").toLowerCase();
        if (message.includes("constancce_tasks")) throw new Error("task_sync_v4_migration_required");
        throw error;
      }

      // Migração automática: se ainda não há rows atômicos, importa o snapshot antigo.
      if (!(rows || []).length && Array.isArray(seedTasks) && seedTasks.length) {
        const now = new Date().toISOString();
        const imports = seedTasks
          .filter((task: any) => String(task?.id || ""))
          .map((task: any) => ({
            user_id: user.id,
            task_id: String(task.id),
            payload: task,
            revision: 1,
            deleted_at: null,
            updated_at: now,
          }));
        if (imports.length) {
          const { error: importError } = await admin.from("constancce_tasks").upsert(imports, { onConflict: "user_id,task_id" });
          if (importError) throw importError;
          return {
            tasks: imports.map((row: any) => row.payload),
            taskRevisions: Object.fromEntries(imports.map((row: any) => [row.task_id, row.revision])),
            updatedAt: now,
          };
        }
      }

      const active = (rows || []).filter((row: any) => !row.deleted_at);
      return {
        tasks: active.map((row: any) => row.payload),
        taskRevisions: Object.fromEntries((rows || []).map((row: any) => [String(row.task_id), Number(row.revision || 0)])),
        updatedAt: (rows || []).map((row: any) => row.updated_at).filter(Boolean).sort().at(-1) || null,
      };
    };

    const migrateLegacyState = async () => {
      const { data: existing, error: stateError } = await admin
        .from("constancce_sync_state")
        .select("data,revision,field_revisions,updated_at")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!stateError && existing) return existing;
      if (stateError && !String(stateError.message || "").toLowerCase().includes("constancce_sync_state")) {
        console.error("sync-v3 state read error", stateError);
      }

      const [{ data: domainRows, error: domainError }, { data: legacyRow, error: legacyError }] = await Promise.all([
        admin.from("constancce_domain_sync").select("domain,data,updated_at").eq("user_id", user.id),
        admin.from("device_sync").select("data,updated_at").eq("user_id", user.id).maybeSingle(),
      ]);
      if (domainError || legacyError) throw domainError || legacyError;

      const merged: Record<string, any> = { ...(legacyRow?.data || {}) };
      let latest = Date.parse(String(legacyRow?.updated_at || "")) || 0;
      for (const row of domainRows || []) {
        Object.assign(merged, row?.data || {});
        latest = Math.max(latest, Date.parse(String(row?.updated_at || "")) || 0);
      }
      const hasData = Boolean(legacyRow?.data) || Boolean((domainRows || []).length);
      if (!hasData) return null;

      const canonical = canonicalSnapshot(merged);
      const fieldRevisions: Record<string, number> = {};
      for (const fields of Object.values(DOMAIN_FIELDS)) {
        for (const field of fields) if (Object.prototype.hasOwnProperty.call(canonical, field)) fieldRevisions[field] = 1;
      }
      const updatedAt = latest ? new Date(latest).toISOString() : new Date().toISOString();
      const { data: inserted, error: insertError } = await admin
        .from("constancce_sync_state")
        .upsert({ user_id: user.id, data: canonical, revision: 1, field_revisions: fieldRevisions, updated_at: updatedAt }, { onConflict: "user_id" })
        .select("data,revision,field_revisions,updated_at")
        .single();
      if (insertError) throw insertError;
      return inserted;
    };

    const legacyMirror = async (stateData: Record<string, any>, changedKeys: string[], updatedAt: string) => {
      try {
        const domains = changedKeys.length ? domainsForKeys(changedKeys) : Object.keys(DOMAIN_FIELDS);
        const rows = domains.map((domain) => {
          const payload: Record<string, unknown> = {};
          for (const field of DOMAIN_FIELDS[domain] || []) payload[field] = stateData?.[field];
          if (domain === "account") payload.schemaVersion = Number(stateData?.schemaVersion || 0);
          return { user_id: user.id, domain, data: payload, updated_at: updatedAt };
        });
        if (rows.length) await admin.from("constancce_domain_sync").upsert(rows, { onConflict: "user_id,domain" });
        await admin.from("device_sync").upsert({
          user_id: user.id,
          data: canonicalSnapshot(stateData),
          updated_at: updatedAt,
        }, { onConflict: "user_id" });
      } catch (mirrorError) {
        console.error("sync-v3 legacy mirror error", mirrorError);
      }
    };

    if (req.method === "GET") {
      const state = await migrateLegacyState();
      if (!state) {
        const atomicTasks = await loadAtomicTasks([]);
        return Response.json(
          {
            protocolVersion: 4,
            data: atomicTasks.tasks.length ? { tasks: atomicTasks.tasks } : null,
            revision: 0,
            fieldRevisions: {},
            taskRevisions: atomicTasks.taskRevisions || {},
            updated_at: atomicTasks.updatedAt || null,
          },
          { headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" } },
        );
      }
      const atomicTasks = await loadAtomicTasks(array(state.data?.tasks));
      return Response.json(
        {
          protocolVersion: 4,
          data: { ...(state.data || {}), tasks: atomicTasks.tasks },
          revision: Number(state.revision || 0),
          fieldRevisions: state.field_revisions || {},
          taskRevisions: atomicTasks.taskRevisions || {},
          updated_at: [state.updated_at, atomicTasks.updatedAt].filter(Boolean).sort().at(-1) || null,
        },
        { headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" } },
      );
    }

    const raw = await req.text();
    if (raw.length > 3_000_000) return Response.json({ error: "payload_too_large" }, { status: 413, headers });
    const body = JSON.parse(raw || "{}");
    const data = body?.data && typeof body.data === "object" ? body.data : {};
    const changedKeys: string[] = Array.isArray(body?.changedKeys)
      ? Array.from(new Set<string>(body.changedKeys
          .map((value: unknown) => String(value))
          .filter((key: string) => Object.values(DOMAIN_FIELDS).flat().includes(key))))
          .slice(0, 40)
      : [];
    const taskOps: any[] = Array.isArray(body?.taskOps)
      ? body.taskOps.slice(0, 200).filter((op: any) => ["upsert", "delete"].includes(String(op?.op || "")) && String(op?.id || ""))
      : [];
    if (!changedKeys.length && !taskOps.length) return Response.json({ error: "changed_keys_required" }, { status: 422, headers });

    let state = await migrateLegacyState();
    if (!state) {
      const { data: inserted, error: insertError } = await admin
        .from("constancce_sync_state")
        .upsert({ user_id: user.id, data: {}, revision: 0, field_revisions: {}, updated_at: new Date().toISOString() }, { onConflict: "user_id" })
        .select("data,revision,field_revisions,updated_at")
        .single();
      if (insertError) throw insertError;
      state = inserted;
    }

    const atomicBefore = await loadAtomicTasks(array(state?.data?.tasks));
    const baseline: Record<string, any> = { ...(state?.data || {}), tasks: atomicBefore.tasks };
    const patch: Record<string, any> = {};
    for (const key of changedKeys) {
      if (Object.prototype.hasOwnProperty.call(data, key)) patch[key] = data[key];
    }
    if (Object.prototype.hasOwnProperty.call(data, "schemaVersion")) patch.schemaVersion = Number(data.schemaVersion || 0);
    const mergedIncoming = { ...baseline, ...patch };

    const { data: access, error: accessError } = await admin
      .from("constancce_access")
      .select("plan,trial_ends_at,payment_status")
      .eq("user_id", user.id)
      .maybeSingle();
    if (accessError) return Response.json({ error: "access_check_failed" }, { status: 503, headers });
    const trialEnd = access?.trial_ends_at ? new Date(access.trial_ends_at).getTime() : NaN;
    const isPro = access?.plan === "lifetime" || (access?.plan === "trial" && access?.payment_status === "complimentary_trial" && Number.isFinite(trialEnd) && Date.now() < trialEnd);
    const domains = domainsForKeys(changedKeys);

    if (domains.includes("tasks")) {
      const violation = validateNewTaskTimes(mergedIncoming, baseline);
      if (violation) return Response.json({ error: violation }, { status: 422, headers });
    }
    if (!isPro) {
      const violation = validateFree(mergedIncoming, baseline, domains);
      if (violation) return Response.json({ error: violation, pro_required: true }, { status: 403, headers });
    }

    let atomicAfter = atomicBefore;
    let taskConflicts: any[] = [];
    if (domains.includes("tasks") || taskOps.length) {
      // Clientes 1.1.24 enviam operações por item. Clientes antigos continuam
      // aceitos, mas só o V4 recebe garantias fortes multi-dispositivo.
      if (taskOps.length) {
        const taskMutationId = `${String(body?.mutationId || crypto.randomUUID())}:tasks`;
        const { data: taskRows, error: taskError } = await admin.rpc("constancce_apply_task_ops", {
          p_user_id: user.id,
          p_mutation_id: taskMutationId,
          p_client_id: String(body?.clientId || "legacy-client").slice(0, 160),
          p_ops: taskOps,
        });
        if (taskError) {
          const msg = String(taskError.message || "").toLowerCase();
          if (msg.includes("constancce_apply_task_ops")) return Response.json({ error: "task_sync_v4_migration_required" }, { status: 503, headers });
          console.error("task-sync-v4 apply error", taskError);
          return Response.json({ error: "task_sync_apply_failed", details: taskError.message }, { status: 503, headers });
        }
        const taskResult = Array.isArray(taskRows) ? taskRows[0] : taskRows;
        atomicAfter = {
          tasks: Array.isArray(taskResult?.tasks) ? taskResult.tasks : [],
          taskRevisions: taskResult?.task_revisions || {},
          updatedAt: taskResult?.updated_at || null,
        };
        taskConflicts = Array.isArray(taskResult?.conflicts) ? taskResult.conflicts : [];
      } else {
        atomicAfter = await loadAtomicTasks(array(mergedIncoming?.tasks));
      }
    }

    const protocolV3 = Number(body?.protocolVersion || 0) >= 3 && String(body?.mutationId || "").trim();
    const mutationId = protocolV3 ? String(body.mutationId) : `legacy-${crypto.randomUUID()}`;
    const clientId = String(body?.clientId || "legacy-client").slice(0, 160);
    // Clientes antigos não conhecem revisão por campo. Para eles usamos a revisão
    // atual como base, mantendo compatibilidade durante a atualização gradual.
    const baseFieldRevisions = protocolV3 && body?.baseFieldRevisions && typeof body.baseFieldRevisions === "object"
      ? body.baseFieldRevisions
      : (state?.field_revisions || {});

    const genericChangedKeys = changedKeys.filter((key: string) => key !== "tasks");
    const genericPatch: Record<string, any> = { ...patch };
    delete genericPatch.tasks;

    let result: any = {
      applied: true, duplicate: false, conflict: false, conflicting_keys: [],
      revision: Number(state?.revision || 0), field_revisions: state?.field_revisions || {},
      data: state?.data || {}, updated_at: state?.updated_at || null,
    };

    if (genericChangedKeys.length) {
      const { data: rpcRows, error: rpcError } = await admin.rpc("constancce_apply_sync_patch", {
      p_user_id: user.id,
      p_patch: genericPatch,
      p_changed_keys: genericChangedKeys,
      p_mutation_id: mutationId,
      p_client_id: clientId,
      p_base_field_revisions: baseFieldRevisions,
      });
      if (rpcError) {
        console.error("sync-v3 atomic apply error", rpcError);
        return Response.json({ error: "sync_atomic_apply_failed", details: rpcError.message }, { status: 503, headers });
      }
      result = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
      if (!result) return Response.json({ error: "sync_empty_result" }, { status: 503, headers });
    }

    if (taskConflicts.length) {
      return Response.json({
        error: "sync_conflict",
        protocolVersion: 4,
        conflictingKeys: ["tasks"],
        taskConflicts,
        data: { ...(result.data || state?.data || {}), tasks: atomicAfter.tasks },
        taskRevisions: atomicAfter.taskRevisions || {},
        revision: Number(result.revision || state?.revision || 0),
        fieldRevisions: result.field_revisions || state?.field_revisions || {},
        updated_at: [result.updated_at, atomicAfter.updatedAt].filter(Boolean).sort().at(-1) || null,
      }, { status: 409, headers });
    }

    if (result.conflict) {
      return Response.json({
        error: "sync_conflict",
        protocolVersion: 3,
        conflictingKeys: result.conflicting_keys || [],
        data: { ...(result.data || {}), tasks: atomicAfter.tasks },
        taskRevisions: atomicAfter.taskRevisions || {},
        taskConflicts,
        revision: Number(result.revision || 0),
        fieldRevisions: result.field_revisions || {},
        updated_at: result.updated_at || null,
      }, { status: 409, headers });
    }

    const canonical = {
      ...(result.data || {}),
      tasks: atomicAfter.tasks,
      schemaVersion: Number(result.data?.schemaVersion || body?.schemaVersion || 0),
    };
    const updatedAt = String([result.updated_at, atomicAfter.updatedAt].filter(Boolean).sort().at(-1) || new Date().toISOString());
    await legacyMirror(canonical, changedKeys, updatedAt);

    return Response.json({
      protocolVersion: 4,
      applied: Boolean(result.applied),
      duplicate: Boolean(result.duplicate),
      mutationId,
      saved: changedKeys,
      data: canonical,
      revision: Number(result.revision || 0),
      fieldRevisions: result.field_revisions || {},
      taskRevisions: atomicAfter.taskRevisions || {},
      taskConflicts,
      updated_at: updatedAt,
    }, { headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("domain-sync v3 error", error);
    const message = String((error as Error)?.message || "");
    if (message.includes("task_sync_v4_migration_required") || message.includes("constancce_tasks") || message.includes("constancce_apply_task_ops")) {
      return Response.json({ error: "task_sync_v4_migration_required" }, { status: 503, headers });
    }
    if (message.includes("constancce_sync_state") || message.includes("constancce_apply_sync_patch")) {
      return Response.json({ error: "sync_v3_migration_required" }, { status: 503, headers });
    }
    return Response.json({ error: "domain_sync_failed" }, { status: 500, headers });
  }
});
