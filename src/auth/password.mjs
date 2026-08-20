import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(crypto.scrypt);
const KEY_LENGTH = 64;
const N = 16384;
const r = 8;
const p = 1;

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 10) {
    throw new Error('Le mot de passe doit contenir au moins 10 caractères.');
  }

  const salt = crypto.randomBytes(16);
  const derived = await scryptAsync(password, salt, KEY_LENGTH, {
    N, r, p, maxmem: 64 * 1024 * 1024
  });

  return [
    'scrypt',
    N,
    r,
    p,
    salt.toString('base64url'),
    Buffer.from(derived).toString('base64url')
  ].join('$');
}

export async function verifyPassword(password, stored) {
  try {
    const [algorithm, n, rValue, pValue, saltB64, hashB64] = stored.split('$');
    if (algorithm !== 'scrypt') return false;

    const expected = Buffer.from(hashB64, 'base64url');
    const actual = Buffer.from(await scryptAsync(
      password,
      Buffer.from(saltB64, 'base64url'),
      expected.length,
      {
        N: Number(n),
        r: Number(rValue),
        p: Number(pValue),
        maxmem: 64 * 1024 * 1024
      }
    ));

    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
