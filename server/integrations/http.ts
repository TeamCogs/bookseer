export class IntegrationError extends Error {}
export async function upstream(
  base: string,
  path: string,
  init: RequestInit = {},
  timeout = 20000,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(base.replace(/\/+$/, '') + path, {
      ...init,
      redirect: 'error',
      signal: init.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(timeout)])
        : AbortSignal.timeout(timeout),
    });
  } catch {
    throw new IntegrationError('The service did not respond. Check its URL, network, and logs.');
  }
  if (!response.ok)
    throw new IntegrationError(
      response.status === 401 || response.status === 403
        ? 'The service refused access. Check credentials and library permissions.'
        : `The service returned HTTP ${response.status}.`,
    );
  return response;
}
export async function readJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new IntegrationError('The service returned an empty response.');
  let size = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 32 * 1024 * 1024) {
      await reader.cancel();
      throw new IntegrationError('The service response exceeded the supported size.');
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new IntegrationError('The service returned invalid JSON.');
  }
}
export function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new IntegrationError('The service returned an unexpected object.');
  return value as Record<string, any>;
}
export function array(value: unknown): Record<string, any>[] {
  if (!Array.isArray(value)) throw new IntegrationError('The service returned an unexpected list.');
  return value.map(object);
}
