import { NextFunction, Request, Response } from 'express';
import { ValidationError } from '@dialer/shared';

/** Thrown by route handlers; turned into a JSON body by the error middleware. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public errors?: ValidationError[],
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new ApiError(404, `${what} not found`);
export const badRequest = (message: string) => new ApiError(400, message);

/** 422 with field-keyed errors, exactly as the client's own validation reports them. */
export const unprocessable = (errors: ValidationError[]) =>
  new ApiError(422, `${errors.length} field${errors.length === 1 ? '' : 's'} need attention`, errors);

/** 409 for the conflicts that name another object, e.g. a DID already routed elsewhere. */
export const conflict = (message: string, extra?: Record<string, unknown>) =>
  new ApiError(409, message, undefined, extra);

export function asyncRoute(
  fn: (req: Request, res: Response) => Promise<unknown> | unknown,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: err.message, errors: err.errors, ...err.extra });
    return;
  }
  // eslint-disable-next-line no-console
  console.error('[server] unhandled', err);
  res.status(500).json({ error: 'Internal error' });
}

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pages: number;
  perPage: number;
}

export function paginate<T>(rows: T[], pageRaw: unknown, perPageRaw: unknown): Page<T> {
  const perPage = Math.min(Math.max(Number(perPageRaw) || 10, 1), 200);
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const page = Math.min(Math.max(Number(pageRaw) || 1, 1), pages);
  return {
    rows: rows.slice((page - 1) * perPage, page * perPage),
    total: rows.length,
    page,
    pages,
    perPage,
  };
}
