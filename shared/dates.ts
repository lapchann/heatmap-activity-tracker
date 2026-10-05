// Activity dates are local calendar dates, never UTC timestamps.
export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function calendarDate(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

export function isCalendarDate(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)
    && localDate(calendarDate(value)) === value;
}

export function datesInYear(year: number): string[] {
  const dates: string[] = [];
  const day = new Date(year, 0, 1, 12);
  while (day.getFullYear() === year) {
    dates.push(localDate(day));
    day.setDate(day.getDate() + 1);
  }
  return dates;
}

export function completionLevel(count: number): number {
  return Math.min(4, Math.max(0, count));
}

export function previousDate(date: string): string {
  const day = calendarDate(date);
  day.setDate(day.getDate() - 1);
  return localDate(day);
}

// Callers supply only the selected streak routine's dates.
export function currentStreak(completionDates: readonly string[], today: string): number {
  const completed = new Set(completionDates);
  let date = completed.has(today) ? today : previousDate(today);
  let streak = 0;
  while (completed.has(date)) {
    streak += 1;
    date = previousDate(date);
  }
  return streak;
}
