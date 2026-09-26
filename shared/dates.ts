// Activity dates are local calendar dates, never UTC timestamps.
export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function calendarDate(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
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

export function completionLevel(completed: number, active: number): number {
  if (active === 0 || completed === 0) return 0;
  if (completed === active) return 4;
  if (completed / active <= 1 / 3) return 1;
  if (completed / active <= 2 / 3) return 2;
  return 3;
}
