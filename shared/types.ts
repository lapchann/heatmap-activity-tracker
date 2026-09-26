export interface Routine {
  id: number;
  name: string;
  completed: boolean;
}

export interface DayActivity {
  date: string;
  active: number;
  completed: number;
}

export interface Dashboard {
  today: string;
  year: number;
  routines: Routine[];
  days: DayActivity[];
}
