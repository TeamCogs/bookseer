let csrf = '';
export function setCsrf(value: string) { csrf = value; }
export async function api<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api' + path, { method, signal, credentials: 'same-origin', headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== '/session') window.dispatchEvent(new Event('session-expired'));
    throw new Error(payload.error || 'The request could not be completed.');
  }
  return payload;
}
export function message(error: unknown) { return error instanceof Error ? error.message : 'Something went wrong. Please try again.'; }
export function time(value?: string) { return value ? new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not synced yet'; }
