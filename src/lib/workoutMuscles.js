// Grupos musculares dos exercícios e montagem do "treino do dia" a partir dos
// treinos que o usuário já registrou (ex.: "quero treinar ombro e tríceps").
// Tudo puro, testado em tests/workout-muscles.test.mjs.

// "Braços" continua na lista para exercícios antigos que não dá para
// identificar pelo nome; os novos já caem em Bíceps, Tríceps ou Antebraço.
export const WORKOUT_MUSCLE_GROUPS = ["Peito", "Costas", "Pernas", "Ombros", "Bíceps", "Tríceps", "Antebraço", "Braços", "Core", "Cardio", "Outro"];

const plain = (text = "") => String(text).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Braços por nome: antebraço antes de bíceps ("rosca punho" é antebraço).
function inferArmGroup(value) {
  if (/(antebraco|punho|rosca inversa)/.test(value)) return "Antebraço";
  if (/(triceps|frances|testa|coice|mergulho|pulley|corda)/.test(value)) return "Tríceps";
  if (/(biceps|rosca|martelo|scott)/.test(value)) return "Bíceps";
  return null;
}

export function inferWorkoutMuscleGroup(name = "") {
  const value = plain(name);
  // Casos específicos antes das regras gerais ("crucifixo" sozinho é peito).
  if (/(supino fechado)/.test(value)) return "Tríceps";
  if (/(crucifixo inverso|face pull|voador inverso)/.test(value)) return "Ombros";
  if (/(supino|peito|crucifixo|voador|crossover)/.test(value)) return "Peito";
  if (/(remada|puxada|costas|pulldown|barra fixa)/.test(value)) return "Costas";
  if (/(agach|leg press|extensora|flexora|panturr|stiff|terra|glute)/.test(value)) return "Pernas";
  if (/(ombro|elevacao lateral|elevacao frontal|desenvolvimento|arnold)/.test(value)) return "Ombros";
  const arm = inferArmGroup(value);
  if (arm) return arm;
  if (/(abd|prancha|core)/.test(value)) return "Core";
  if (/(corrida|esteira|bike|bicicleta|cardio|eliptico)/.test(value)) return "Cardio";
  return "Outro";
}

// Grupo efetivo de um exercício salvo: o escolhido no formulário; os antigos
// "Braços" (de antes da divisão) são reclassificados pelo nome quando possível.
export function exerciseMuscleGroup(exercise = {}) {
  const saved = exercise?.muscleGroup;
  if (!saved || saved === "Outro") return inferWorkoutMuscleGroup(exercise?.name);
  if (saved === "Braços") return inferArmGroup(plain(exercise?.name)) || "Braços";
  return saved;
}

const exerciseKey = (exercise) => plain(exercise?.name).replace(/\s+/g, " ").trim();

// Treinos que o usuário registrou (os montados pelo app ficam de fora, para
// não virarem fonte de si mesmos).
const sourceTemplates = (templates = []) => (Array.isArray(templates) ? templates : []).filter((t) => t && !t.generated);

// Quantos exercícios diferentes existem por grupo nos treinos registrados.
// A tela só oferece grupos com pelo menos um exercício.
export function availableMuscleGroups(templates = []) {
  const byGroup = new Map();
  for (const template of sourceTemplates(templates)) {
    for (const exercise of template.exercises || []) {
      const group = exerciseMuscleGroup(exercise);
      if (!byGroup.has(group)) byGroup.set(group, new Set());
      byGroup.get(group).add(exerciseKey(exercise));
    }
  }
  return WORKOUT_MUSCLE_GROUPS
    .filter((group) => byGroup.has(group))
    .map((group) => ({ group, count: byGroup.get(group).size }));
}

export const builtWorkoutKey = (groups = []) =>
  [...groups].sort((a, b) => WORKOUT_MUSCLE_GROUPS.indexOf(a) - WORKOUT_MUSCLE_GROUPS.indexOf(b)).join("+");

// Monta o treino com TODOS os exercícios dos grupos escolhidos, vindos dos
// treinos registrados: na ordem dos grupos escolhidos e, dentro de cada grupo,
// na ordem em que aparecem nos treinos. O mesmo exercício em dois treinos
// entra uma vez só. `newId` gera ids para as cópias.
export function buildWorkoutFromGroups(templates = [], groups = [], { newId }) {
  const ordered = [...new Set(groups)].sort((a, b) => WORKOUT_MUSCLE_GROUPS.indexOf(a) - WORKOUT_MUSCLE_GROUPS.indexOf(b));
  const seen = new Set();
  const exercises = [];
  for (const group of ordered) {
    for (const template of sourceTemplates(templates)) {
      for (const exercise of template.exercises || []) {
        if (exerciseMuscleGroup(exercise) !== group) continue;
        const key = exerciseKey(exercise);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        exercises.push({
          ...exercise,
          id: newId(),
          muscleGroup: group,
          sourceTemplateId: template.id,
          sourceExerciseId: exercise.id,
        });
      }
    }
  }
  return {
    name: ordered.join(" + "),
    generated: true,
    generatedKey: builtWorkoutKey(ordered),
    groups: ordered,
    scheduleDays: [],
    exercises,
  };
}
