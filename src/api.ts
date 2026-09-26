import type { Dashboard } from '../shared/types';

export async function requestDashboard(path = '/api/dashboard', options?: RequestInit): Promise<Dashboard> {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${response.status}). Please try again.`);
  }
  return response.json() as Promise<Dashboard>;
}
