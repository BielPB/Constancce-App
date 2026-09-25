import { useRef, useState } from "react";
import { createEagerSetter } from "../lib/eagerState.js";

// Estado + setter imediato (ver src/lib/eagerState.js): o updater roda uma vez,
// na hora, a partir do valor mais recente, e os efeitos dentro dele não se
// repetem nem acontecem durante a renderização.
function useEagerState(initial) {
  const [value, setValue] = useState(initial);
  const ref = useRef(value);
  const setterRef = useRef(null);
  if (!setterRef.current) setterRef.current = createEagerSetter(ref, setValue);
  return [value, setterRef.current];
}

export function useConstancceData() {
  const [profile, setProfileState] = useEagerState(null);
  const [habits, setHabits] = useEagerState([]);
  const [completions, setCompletions] = useEagerState([]);
  const [tasks, setTasks] = useEagerState([]);
  const [goals, setGoals] = useEagerState([]);
  const [unlocked, setUnlocked] = useEagerState([]);
  const [workoutTemplates, setWorkoutTemplates] = useEagerState([]);
  const [workoutSessions, setWorkoutSessions] = useEagerState([]);
  const [foods, setFoods] = useEagerState([]);
  const [mealLog, setMealLog] = useEagerState([]);
  const [transactions, setTransactions] = useEagerState([]);
  const [goalProgressLog, setGoalProgressLog] = useEagerState([]);
  const [habitChecklistLog, setHabitChecklistLog] = useEagerState([]);

  return {
    profile, setProfileState,
    habits, setHabits,
    completions, setCompletions,
    tasks, setTasks,
    goals, setGoals,
    unlocked, setUnlocked,
    workoutTemplates, setWorkoutTemplates,
    workoutSessions, setWorkoutSessions,
    foods, setFoods,
    mealLog, setMealLog,
    transactions, setTransactions,
    goalProgressLog, setGoalProgressLog,
    habitChecklistLog, setHabitChecklistLog,
  };
}
