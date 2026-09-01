import { useState } from "react";

export function useConstancceData() {
  const [profile, setProfileState] = useState(null);
  const [habits, setHabits] = useState([]);
  const [completions, setCompletions] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [goals, setGoals] = useState([]);
  const [unlocked, setUnlocked] = useState([]);
  const [workoutTemplates, setWorkoutTemplates] = useState([]);
  const [workoutSessions, setWorkoutSessions] = useState([]);
  const [foods, setFoods] = useState([]);
  const [mealLog, setMealLog] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [goalProgressLog, setGoalProgressLog] = useState([]);
  const [habitChecklistLog, setHabitChecklistLog] = useState([]);

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
