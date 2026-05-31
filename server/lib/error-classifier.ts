import { AxiosError } from 'axios';

export type WahaErrorKind =
  | 'auth'           // 401/403 — sessão deslogada ou apikey errada
  | 'rate-limit'     // 429
  | 'session-down'   // 5xx ou conn refused
  | 'invalid-target' // 422/400 com mensagem de phone inválido
  | 'transient'      // timeout, ECONNRESET
  | 'unknown';

export interface ClassifiedError {
  kind: WahaErrorKind;
  retryable: boolean;
  /** se true, dispara circuit breaker / pausa campanha */
  pauseSession: boolean;
  /** multiplicador adicional aplicado ao próximo delay */
  backoffMultiplier: number;
  message: string;
}

export function classifyWahaError(err: unknown): ClassifiedError {
  const msg = (err as Error)?.message || String(err);
  const ax = err as AxiosError | undefined;
  const status = ax?.response?.status;
  const code = (ax as any)?.code as string | undefined;

  if (status === 401 || status === 403) {
    return { kind: 'auth', retryable: false, pauseSession: true, backoffMultiplier: 1, message: msg };
  }
  if (status === 429) {
    return { kind: 'rate-limit', retryable: true, pauseSession: false, backoffMultiplier: 10, message: msg };
  }
  if (status === 422 || (status === 400 && /phone|number|chatId/i.test(msg))) {
    return { kind: 'invalid-target', retryable: false, pauseSession: false, backoffMultiplier: 1, message: msg };
  }
  if (status && status >= 500) {
    return { kind: 'session-down', retryable: true, pauseSession: true, backoffMultiplier: 5, message: msg };
  }
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT') {
    return { kind: 'session-down', retryable: true, pauseSession: true, backoffMultiplier: 5, message: msg };
  }
  if (code === 'ECONNRESET' || /timeout/i.test(msg)) {
    return { kind: 'transient', retryable: true, pauseSession: false, backoffMultiplier: 2, message: msg };
  }
  return { kind: 'unknown', retryable: true, pauseSession: false, backoffMultiplier: 2, message: msg };
}
