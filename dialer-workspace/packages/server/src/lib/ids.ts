import { randomUUID } from 'crypto';

/** Short, readable, prefixed ids — easier to eyeball in a JSON store than raw UUIDs. */
export function id(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}
