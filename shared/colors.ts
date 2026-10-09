export const themeColors = [
  { value: '#216743', name: 'Green' },
  { value: '#2864b4', name: 'Blue' },
  { value: '#8054ad', name: 'Purple' },
  { value: '#b33f67', name: 'Rose' },
  { value: '#a45b18', name: 'Amber' },
  { value: '#397e85', name: 'Teal' },
] as const;

export type ThemeColor = typeof themeColors[number]['value'];
export const defaultRoutineColor = themeColors[0].value;
