import type { ValidationError } from '@dialer/shared';

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pages: number;
  perPage: number;
}

export class ApiFailure extends Error {
  constructor(
    public status: number,
    message: string,
    public errors: ValidationError[] = [],
    public body: any = null,
  ) {
    super(message);
  }
  /** Field-keyed lookup so a form can attach each message to the right input. */
  byField(): Record<string, string> {
    return Object.fromEntries(this.errors.map((e) => [e.field, e.message]));
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiFailure(res.status, json?.error ?? res.statusText, json?.errors ?? [], json);
  }
  return json as T;
}

export const api = {
  get: <T,>(path: string) => request<T>('GET', path),
  post: <T,>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T,>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  put: <T,>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  del: <T,>(path: string) => request<T>('DELETE', path),
};

export function qs(params: Record<string, string | number | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}
