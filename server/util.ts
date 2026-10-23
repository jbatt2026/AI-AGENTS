import { timingSafeEqual } from 'node:crypto';

/** Constant-time string comparison; unequal lengths fail fast (length is not secret here). */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
