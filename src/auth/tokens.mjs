import crypto from 'node:crypto';
import { config } from '../config.mjs';

export function hashOpaqueToken(token) {
  return crypto.createHmac('sha256', config().sessionSecret).update(token).digest('hex');
}

export function newSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function newInviteCode() {
  return crypto.randomBytes(18).toString('base64url');
}

export function hashInviteCode(code) {
  return crypto.createHmac('sha256', config().sessionSecret)
    .update(`invite:${code.trim()}`)
    .digest('hex');
}

export function hashIp(ip) {
  if (!ip) return null;
  return crypto.createHmac('sha256', config().sessionSecret).update(`ip:${ip}`).digest('hex');
}
