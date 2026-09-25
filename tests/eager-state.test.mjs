import test from "node:test";
import assert from "node:assert/strict";
import { createEagerSetter } from "../src/lib/eagerState.js";

// O app tem ~30 mutações que salvam/avisam/registram atividade dentro do
// updater de setState. Com o setter imediato, o updater roda uma vez, na hora,
// a partir do valor mais recente.

const setup = (initial) => {
  const ref = { current: initial };
  const commits = [];
  return { ref, commits, set: createEagerSetter(ref, (value) => commits.push(value)) };
};

test("updater roda uma única vez por chamada, com efeitos colaterais uma vez só", () => {
  const { set, commits } = setup([]);
  let saves = 0;
  set((prev) => { saves += 1; return [...prev, "hábito feito"]; });
  assert.equal(saves, 1);
  assert.deepEqual(commits, [["hábito feito"]]);
});

test("chamadas seguidas no mesmo clique encadeiam a partir do valor mais recente (não do render)", () => {
  const { set, ref } = setup([]);
  const log = [];
  // Mesma situação do histórico das metas: duas adições antes do próximo render.
  set((prev) => { const next = [...prev, "+5"]; log.push(next); return next; });
  set((prev) => { const next = [...prev, "+1"]; log.push(next); return next; });
  assert.deepEqual(ref.current, ["+5", "+1"]);
  assert.deepEqual(log.at(-1), ["+5", "+1"], "o segundo não apaga o primeiro");
});

test("valor direto também atualiza; mesmo valor não re-renderiza", () => {
  const { set, commits, ref } = setup([1]);
  set([2]);
  assert.deepEqual(ref.current, [2]);
  set((prev) => prev); // setIfChanged devolve a mesma referência quando nada mudou
  assert.equal(commits.length, 1);
});

test("antes (updater puro do React rodado duas vezes) os efeitos duplicavam; agora não", () => {
  // Simula o que o React faz em StrictMode: chamar o updater duas vezes.
  let reactSaves = 0;
  const updater = (prev) => { reactSaves += 1; return [...prev, "x"]; };
  updater([]); updater([]);
  assert.equal(reactSaves, 2, "com o setState padrão, o salvamento rodava 2x");

  const { set } = setup([]);
  let eagerSaves = 0;
  set((prev) => { eagerSaves += 1; return [...prev, "x"]; });
  assert.equal(eagerSaves, 1);
});
