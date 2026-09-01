import test from "node:test";
import assert from "node:assert/strict";

test("1.1.28 hábitos usam chave lógica por dia entre dispositivos", async () => {
  const routine = await import("../src/lib/routineSyncV1.js");
  assert.equal(
    routine.routineEntityId("habit_completion", { id: "random-a", habitId: "agua", date: "2026-08-31" }),
    "agua:2026-08-31"
  );
  assert.equal(
    routine.routineEntityId("habit_checklist", { id: "random-b", habitId: "agua", itemId: "600ml-1", date: "2026-08-31" }),
    "agua:600ml-1:2026-08-31"
  );
});
