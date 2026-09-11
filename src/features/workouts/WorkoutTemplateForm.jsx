import React, { useState } from "react";
import { Star, X, Plus } from "lucide-react";
import { Modal, Field, useConfirm } from "../../components/ui.jsx";

// Usado tanto por WorkoutsView.jsx (aba Treinos) quanto por CalendarView em
// App.jsx (atalho "Criar novo treino" ao agendar um dia no calendário) — fica
// em arquivo próprio pra não duplicar, já que os dois precisam do componente.
// Utilitários pequenos duplicados de propósito (mesmo padrão de
// ProfessionalView.jsx), pra este arquivo não depender de App.jsx nem de
// WorkoutsView.jsx.
const uid = () => Math.random().toString(36).slice(2, 10);
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const WORKOUT_MUSCLE_GROUPS = ["Peito", "Costas", "Pernas", "Ombros", "Braços", "Core", "Cardio", "Outro"];
const normalizeWorkoutExerciseName = (name = "") =>
  String(name || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
const inferWorkoutMuscleGroup = (name = "") => {
  const value = String(name).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/(supino|peito|crucifixo|voador|crossover)/.test(value)) return "Peito";
  if (/(remada|puxada|costas|pulldown|barra fixa)/.test(value)) return "Costas";
  if (/(agach|leg press|extensora|flexora|panturr|stiff|terra|glute)/.test(value)) return "Pernas";
  if (/(ombro|elevacao lateral|desenvolvimento)/.test(value)) return "Ombros";
  if (/(biceps|triceps|rosca|pulley|frances)/.test(value)) return "Braços";
  if (/(abd|prancha|core)/.test(value)) return "Core";
  if (/(corrida|esteira|bike|bicicleta|cardio|eliptico)/.test(value)) return "Cardio";
  return "Outro";
};

export default function WorkoutTemplateForm({ initial, onSave, onClose, exerciseLibrary = [], defaultScheduleDays = [] }) {
  const isCopy = Boolean(initial?.__copyMode);
  const [confirm, confirmDialog] = useConfirm();
  const [name, setName] = useState(initial?.name || "");
  const [scheduleDays, setScheduleDays] = useState(initial?.scheduleDays || defaultScheduleDays);
  const [exercises, setExercises] = useState(() =>
    initial?.exercises?.length
      ? initial.exercises.map((exercise) => ({
          ...exercise,
          load: exercise.load ?? "",
          muscleGroup: exercise.muscleGroup || inferWorkoutMuscleGroup(exercise.name),
          restSeconds: Number(exercise.restSeconds || 90),
          favorite: Boolean(exercise.favorite),
          videoUrl: String(exercise.videoUrl || ""),
        }))
      : [{
          id: uid(),
          name: "",
          sets: 3,
          reps: "10-12",
          load: "",
          muscleGroup: "Outro",
          restSeconds: 90,
          favorite: false,
          videoUrl: "",
        }]
  );

  const update = (id, patch) =>
    setExercises((prev) => prev.map((exercise) => exercise.id === id ? { ...exercise, ...patch } : exercise));

  const addExercise = () =>
    setExercises((prev) => [
      ...prev,
      {
        id: uid(),
        name: "",
        sets: 3,
        reps: "10-12",
        load: "",
        muscleGroup: "Outro",
        restSeconds: 90,
        favorite: false,
        videoUrl: "",
      },
    ]);

  const toggleScheduleDay = (day) =>
    setScheduleDays((prev) =>
      prev.includes(day)
        ? prev.filter((item) => item !== day)
        : [...prev, day].sort()
    );

  const removeExercise = async (id) => {
    if (!(await confirm("Tem certeza que deseja remover este exercício?"))) return;
    setExercises((prev) => prev.filter((exercise) => exercise.id !== id));
  };

  return (
    <Modal title={isCopy ? "Novo treino a partir de cópia" : initial ? "Editar treino" : "Novo treino"} onClose={onClose} width={620}>
      <Field label="Nome do treino">
        <input
          className="w-full p-3 ring-focus"
          placeholder="Ex: Treino A — Peito e Tríceps"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>

      <Field label="Programação semanal (opcional)">
        <div className="grid grid-cols-7 gap-1.5">
          {WEEKDAYS.map((label, index) => (
            <button
              key={index}
              type="button"
              className="rounded-xl py-2 text-xs"
              onClick={() => toggleScheduleDay(index)}
              style={{
                border: `1px solid ${scheduleDays.includes(index) ? "var(--brass)" : "var(--border)"}`,
                background: scheduleDays.includes(index) ? "var(--surface-2)" : "transparent",
                color: scheduleDays.includes(index) ? "var(--brass)" : "var(--text-dim)",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </Field>

      <datalist id="constancce-exercise-library">
        {exerciseLibrary.map((item) => (
          <option key={item.name} value={item.name}>{item.lastLoad ? `${item.lastLoad} kg` : ""}</option>
        ))}
      </datalist>

      <div className="flex items-end justify-between gap-3 mb-2">
        <div>
          <p className="text-xs text-dim">Exercícios</p>
          <p className="text-[10px] text-faint mt-0.5">O básico fica visível. Grupo muscular e descanso ajudam o app a organizar melhor sua evolução.</p>
        </div>
        <span className="chip">{exercises.length}</span>
      </div>

      <div className="flex flex-col gap-2 mb-3">
        {exercises.map((exercise, index) => (
          <div key={exercise.id} className="workout-form-exercise surface-2 rounded-xl p-3">
            <div className="flex items-center gap-2 mb-2">
              <button
                type="button"
                className="btn-ghost rounded-lg p-1.5 shrink-0"
                title={exercise.favorite ? "Remover dos favoritos" : "Favoritar exercício"}
                onClick={() => update(exercise.id, { favorite: !exercise.favorite })}
              >
                <Star size={14} className={exercise.favorite ? "text-brass" : "text-faint"} fill={exercise.favorite ? "currentColor" : "none"} />
              </button>

              <input
                list="constancce-exercise-library"
                className="flex-1 min-w-0 p-2 text-sm ring-focus"
                placeholder={`Exercício ${index + 1}`}
                value={exercise.name}
                onChange={(event) => {
                  const nextName = event.target.value;
                  const libraryMatch = exerciseLibrary.find((item) =>
                    normalizeWorkoutExerciseName(item.name) === normalizeWorkoutExerciseName(nextName)
                  );
                  update(exercise.id, {
                    name: nextName,
                    muscleGroup:
                      exercise.muscleGroup === "Outro" || !exercise.muscleGroup
                        ? inferWorkoutMuscleGroup(nextName)
                        : exercise.muscleGroup,
                    videoUrl: exercise.videoUrl || libraryMatch?.videoUrl || "",
                  });
                }}
              />

              {exercises.length > 1 && (
                <button className="btn-ghost rounded-lg p-2" onClick={() => removeExercise(exercise.id)}>
                  <X size={14} />
                </button>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2">
              <input
                type="number"
                min={1}
                className="p-2 text-sm ring-focus"
                placeholder="Séries"
                value={exercise.sets}
                onChange={(event) => update(exercise.id, { sets: Number(event.target.value) })}
              />
              <input
                className="p-2 text-sm ring-focus"
                placeholder="Repetições"
                value={exercise.reps}
                onChange={(event) => update(exercise.id, { reps: event.target.value })}
              />
              <input
                type="number"
                min={0}
                step="0.5"
                className="p-2 text-sm ring-focus"
                placeholder="Carga kg"
                value={exercise.load ?? ""}
                onChange={(event) => update(exercise.id, { load: event.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-2 mt-2">
              <select
                className="p-2 text-xs ring-focus"
                value={exercise.muscleGroup || "Outro"}
                onChange={(event) => update(exercise.id, { muscleGroup: event.target.value })}
              >
                {WORKOUT_MUSCLE_GROUPS.map((group) => <option key={group} value={group}>{group}</option>)}
              </select>

              <select
                className="p-2 text-xs ring-focus"
                value={Number(exercise.restSeconds || 90)}
                onChange={(event) => update(exercise.id, { restSeconds: Number(event.target.value) })}
              >
                <option value={60}>Descanso 60s</option>
                <option value={90}>Descanso 90s</option>
                <option value={120}>Descanso 120s</option>
              </select>
            </div>

            <div className="mt-2">
              <input
                type="url"
                className="w-full p-2 text-xs ring-focus"
                placeholder="Vídeo explicativo (YouTube, Vimeo ou MP4)"
                value={exercise.videoUrl || ""}
                onChange={(event) => update(exercise.id, { videoUrl: event.target.value })}
              />
              <p className="text-[9px] text-faint mt-1">
                O vídeo abre ao tocar no nome do exercício durante o treino. O mesmo link é reaproveitado em exercícios com o mesmo nome.
              </p>
            </div>
          </div>
        ))}
      </div>

      <button
        className="btn-ghost rounded-xl py-2 w-full text-sm mb-3 flex items-center justify-center gap-1"
        onClick={addExercise}
      >
        <Plus size={14} /> Adicionar exercício
      </button>

      <button
        disabled={!name.trim() || exercises.some((exercise) => !exercise.name.trim())}
        className="btn-primary w-full rounded-xl py-3 disabled:opacity-40"
        onClick={() => {
          const cleanExercises = exercises.map((exercise) => ({
            ...exercise,
            id: isCopy ? uid() : exercise.id,
            name: exercise.name.trim(),
            sets: Math.max(1, Number(exercise.sets) || 1),
            reps: String(exercise.reps || "").trim(),
            load: exercise.load === "" ? "" : Number(exercise.load || 0),
            muscleGroup: exercise.muscleGroup || inferWorkoutMuscleGroup(exercise.name),
            restSeconds: Number(exercise.restSeconds || 90),
            favorite: Boolean(exercise.favorite),
            videoUrl: String(exercise.videoUrl || "").trim(),
          }));

          onSave({
            ...(isCopy ? {} : initial || {}),
            id: isCopy ? uid() : (initial?.id || uid()),
            name: name.trim(),
            scheduleDays,
            exercises: cleanExercises,
          });
        }}
      >
        {isCopy ? "Criar treino copiado" : initial ? "Salvar alterações" : "Salvar treino"}
      </button>
      {confirmDialog}
    </Modal>
  );
}
