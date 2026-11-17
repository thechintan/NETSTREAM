import * as jose from 'jose';
import { config } from '../config/index.js';

const secretKey = new TextEncoder().encode(config.JWT_SECRET);

export interface JwtUserPayload {
  id: string;
  username: string;
  email: string;
}

export async function signAccessToken(payload: JwtUserPayload): Promise<string> {
  return new jose.SignJWT({
    username: payload.username,
    email: payload.email,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.id)
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(secretKey);
}

export async function verifyAccessToken(token: string): Promise<JwtUserPayload | null> {
  try {
    const { payload } = await jose.jwtVerify(token, secretKey);
    if (!payload.sub || typeof payload.username !== 'string' || typeof payload.email !== 'string') {
      return null;
    }
    return {
      id: payload.sub,
      username: payload.username,
      email: payload.email,
    };
  } catch {
    return null;
  }
}
