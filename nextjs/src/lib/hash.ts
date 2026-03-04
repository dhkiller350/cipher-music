import bcrypt from 'bcryptjs';
import { createHash, timingSafeEqual } from 'crypto';

const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** Hash a refresh token (like a password) for secure DB storage */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time comparison of hashed tokens */
export function compareTokenHash(token: string, hash: string): boolean {
  const computed = hashToken(token);
  try {
    return timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(hash, 'hex'));
  } catch {
    return false;
  }
}
