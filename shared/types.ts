import type { ThemeColor } from './colors.js';

export type RoutineType = 'heatmap' | 'streak';

export interface Appearance {
  color: ThemeColor;
  mode: 'light' | 'dark';
}

export interface Routine {
  id: number;
  name: string;
  type: RoutineType;
  position: number;
  accentColor: string;
  symbol: string;
  completed: boolean;
}

export interface HeatmapRoutine extends Routine { type: 'heatmap' }
export interface StreakRoutine extends Routine {
  type: 'streak';
  streak: number;
  completionDates: string[];
}

export interface DayActivity {
  date: string;
  count: number;
  completedRoutines: Pick<HeatmapRoutine, 'id' | 'name' | 'symbol'>[];
}

export interface Dashboard {
  today: string;
  year: number;
  firstYear: number;
  appearance: Appearance;
  heatmapRoutines: HeatmapRoutine[];
  streakRoutines: StreakRoutine[];
  days: DayActivity[];
}
