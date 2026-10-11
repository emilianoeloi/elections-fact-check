import type { z } from 'zod';
import type { Settings } from './schemas';

export class BackendError extends Error {
  constructor(message: string, readonly kind: 'network' | 'http' | 'timeout' | 'auth' | 'parse' | 'aborted', readonly status?: number) {
    super(message);
  }
  /** Falhas que valem uma nova tentativa automática. */
  get transient(): boolean {
    return this.kind === 'network' || this.kind === 'timeout' || (this.kind === 'http' && (this.status ?? 0) >= 500 && this.status !== 503);
  }
}

export interface BackendOptions {
  settings: Pick<Settings, 'backendUrl' | 'backendToken'>;
  fetchImpl?: typeof fetch;
}

/** Chamada ao backend com token opcional, timeout, cancelamento e validação Zod da resposta. */
export async function backendRequest<T>(
  opts: BackendOptions,
  path: string,
  init: { method?: 'GET' | 'POST'; body?: BodyInit; contentType?: string; signal?: AbortSignal; timeoutMs?: number },
  schema: z.ZodType<T>,
): Promise<T> {
  const f = opts.fetchImpl ?? fetch;
  const headers: Record<string, string> = {};
  if (init.contentType) headers['content-type'] = init.contentType;
  if (opts.settings.backendToken) headers.authorization = `Bearer ${opts.settings.backendToken}`;
  const timeout = AbortSignal.timeout(init.timeoutMs ?? 45_000);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await f(new URL(path, opts.settings.backendUrl).toString(), { method: init.method ?? 'POST', headers, body: init.body, signal });
  } catch {
    if (init.signal?.aborted) throw new BackendError('Cancelado', 'aborted');
    if (timeout.aborted) throw new BackendError('Tempo esgotado', 'timeout');
    throw new BackendError('Não foi possível falar com o backend', 'network');
  }
  if (res.status === 401) throw new BackendError('Token do backend inválido', 'auth', 401);
  if (!res.ok) {
    let msg = `Backend respondeu ${res.status}`;
    try {
      const j = (await res.json()) as { error?: unknown };
      if (typeof j.error === 'string') msg = j.error;
    } catch { /* corpo não-JSON */ }
    throw new BackendError(msg, 'http', res.status);
  }
  const parsed = schema.safeParse(await res.json().catch(() => undefined));
  if (!parsed.success) throw new BackendError('Resposta inválida do backend', 'parse');
  return parsed.data;
}
