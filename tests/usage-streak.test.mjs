import test from "node:test";
import assert from "node:assert/strict";
import {
  computeUsageStreaks,
  inferLegacyUsageDays,
  normalizeUsageDays,
} from "../src/lib/usageStreak.js";

test("usage streak conta dias consecutivos incluindo hoje", () => {
  const streak = computeUsageStreaks(
    ["2026-08-25", "2026-08-26", "2026-08-27"],
    "2026-08-27"
  );

  assert.equal(streak.current, 3);
  assert.equal(streak.best, 3);
  assert.equal(streak.totalActiveDays, 3);
});

test("usage streak zera a sequência atual quando ontem foi perdido", () => {
  const streak = computeUsageStreaks(
    ["2026-08-24", "2026-08-25", "2026-08-27"],
    "2026-08-27"
  );

  assert.equal(streak.current, 1);
  assert.equal(streak.best, 2);
  assert.equal(streak.totalActiveDays, 3);
});

test("normalização remove duplicados e datas futuras", () => {
  assert.deepEqual(
    normalizeUsageDays(
      ["2026-08-27", "2026-08-27", "2026-08-28", "x"],
      "2026-08-27"
    ),
    ["2026-08-27"]
  );
});

test("migração consegue inferir dias recentes de atividade real", () => {
  const days = inferLegacyUsageDays({
    refDate: "2026-08-27",
    habits: [{ id: "h1", createdAt: "2026-08-25" }],
    completions: [{ habitId: "h1", date: "2026-08-26" }],
    workoutSessions: [{ id: "w1", date: "2026-08-27" }],
  });

  assert.deepEqual(days, ["2026-08-26", "2026-08-27"]);
});


test("migração v2 não conta datas de criação automática como uso", () => {
  const days = inferLegacyUsageDays({
    refDate: "2026-08-27",
    habits: [{ id: "h1", createdAt: "2026-08-23" }],
    tasks: [{ id: "t1", createdAt: "2026-08-23", status: "pendente" }],
    completions: [
      { habitId: "h1", date: "2026-08-24" },
      { habitId: "h1", date: "2026-08-25" },
      { habitId: "h1", date: "2026-08-26" },
    ],
    workoutSessions: [{ id: "w1", date: "2026-08-27" }],
  });

  assert.deepEqual(days, [
    "2026-08-24",
    "2026-08-25",
    "2026-08-26",
    "2026-08-27",
  ]);
});


test("streak de 4 dias retorna 4 quando hoje é o quarto dia", () => {
  const streak = computeUsageStreaks(
    ["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27"],
    "2026-08-27"
  );
  assert.equal(streak.current, 4);
  assert.equal(streak.best, 4);
});
