import test from "node:test";
import assert from "node:assert/strict";
import {
  WORKOUT_MUSCLE_GROUPS,
  inferWorkoutMuscleGroup,
  exerciseMuscleGroup,
  availableMuscleGroups,
  buildWorkoutFromGroups,
  builtWorkoutKey,
} from "../src/lib/workoutMuscles.js";

let seq = 0;
const newId = () => `n${++seq}`;
const ex = (id, name, muscleGroup) => ({ id, name, sets: 3, reps: "10", load: 20, restSeconds: 60, muscleGroup });

const templates = [
  { id: "A", name: "Treino A: Peito e Tríceps", exercises: [
    ex("a1", "Supino reto", "Peito"),
    ex("a2", "Tríceps pulley", "Braços"),          // salvo antes da divisão
    ex("a3", "Tríceps francês", "Tríceps"),
  ] },
  { id: "B", name: "Treino B: Ombro", exercises: [
    ex("b1", "Desenvolvimento com halteres", "Ombros"),
    ex("b2", "Elevação lateral", "Ombros"),
    ex("b3", "Crucifixo inverso", undefined),       // sem grupo salvo
  ] },
  { id: "C", name: "Treino C: Costas e Bíceps", exercises: [
    ex("c1", "Puxada frente", "Costas"),
    ex("c2", "Rosca direta", "Braços"),
    ex("c3", "Elevação lateral", "Ombros"),         // repetido em outro treino
    ex("c4", "Rosca punho", "Braços"),
  ] },
  { id: "G", name: "Ombros + Tríceps", generated: true, exercises: [ex("g1", "Exercício só do treino montado", "Ombros")] },
];

test("inferência pelo nome: bíceps, tríceps e antebraço separados; casos específicos de ombro", () => {
  assert.equal(inferWorkoutMuscleGroup("Tríceps testa"), "Tríceps");
  assert.equal(inferWorkoutMuscleGroup("Supino fechado"), "Tríceps");
  assert.equal(inferWorkoutMuscleGroup("Rosca martelo"), "Bíceps");
  assert.equal(inferWorkoutMuscleGroup("Rosca punho"), "Antebraço");
  assert.equal(inferWorkoutMuscleGroup("Crucifixo inverso"), "Ombros");
  assert.equal(inferWorkoutMuscleGroup("Crucifixo reto"), "Peito");
  assert.equal(inferWorkoutMuscleGroup("Puxada no pulley"), "Costas");
  assert.equal(inferWorkoutMuscleGroup("Alongamento"), "Outro");
  for (const group of ["Bíceps", "Tríceps", "Antebraço", "Braços"]) assert.ok(WORKOUT_MUSCLE_GROUPS.includes(group));
});

test("exercícios antigos salvos como 'Braços' são reclassificados pelo nome; o resto respeita a escolha", () => {
  assert.equal(exerciseMuscleGroup(ex("x", "Tríceps pulley", "Braços")), "Tríceps");
  assert.equal(exerciseMuscleGroup(ex("x", "Rosca direta", "Braços")), "Bíceps");
  assert.equal(exerciseMuscleGroup(ex("x", "Braço completo", "Braços")), "Braços", "sem pista no nome, continua Braços");
  assert.equal(exerciseMuscleGroup(ex("x", "Supino reto", "Ombros")), "Ombros", "escolha manual vence o nome");
  assert.equal(exerciseMuscleGroup(ex("x", "Crucifixo inverso", undefined)), "Ombros");
});

test("grupos disponíveis: só os que existem nos treinos registrados (montados ficam de fora), sem contar repetidos", () => {
  const groups = Object.fromEntries(availableMuscleGroups(templates).map((g) => [g.group, g.count]));
  assert.deepEqual(groups, { Peito: 1, Costas: 1, Ombros: 3, Bíceps: 1, Tríceps: 2, Antebraço: 1 });
});

test("'quero treinar ombro e tríceps': todos os exercícios desses grupos, completos, sem repetir", () => {
  const built = buildWorkoutFromGroups(templates, ["Tríceps", "Ombros"], { newId });
  assert.equal(built.name, "Ombros + Tríceps", "ordem padrão dos grupos, independente da ordem de clique");
  assert.equal(built.generated, true);
  assert.equal(built.generatedKey, builtWorkoutKey(["Ombros", "Tríceps"]));
  assert.deepEqual(built.exercises.map((e) => [e.name, e.muscleGroup]), [
    ["Desenvolvimento com halteres", "Ombros"],
    ["Elevação lateral", "Ombros"],
    ["Crucifixo inverso", "Ombros"],
    ["Tríceps pulley", "Tríceps"],
    ["Tríceps francês", "Tríceps"],
  ]);
  // Cópias completas (séries, reps, carga, descanso) com id novo e origem registrada.
  const first = built.exercises[0];
  assert.deepEqual([first.sets, first.reps, first.load, first.restSeconds], [3, "10", 20, 60]);
  assert.ok(!["b1", "c3", "g1"].includes(first.id));
  assert.equal(first.sourceTemplateId, "B");
  assert.ok(!built.exercises.some((e) => e.name === "Exercício só do treino montado"));
});

test("chave do treino montado não depende da ordem escolhida (reaproveita o mesmo)", () => {
  assert.equal(builtWorkoutKey(["Tríceps", "Ombros"]), builtWorkoutKey(["Ombros", "Tríceps"]));
});
