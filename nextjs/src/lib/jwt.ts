import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

const ACCESS_SECRET = new TextEncoder().encode(
  process.env.JWT_ACCESS_SECRET ?? 'cipher-music-access-secret-change-in-production'
);
const REFRESH_SECRET = new TextEncoder().encode(
  process.env.JWT_REFRESH_SECRET ?? 'cipher-music-refresh-secret-change-in-production'
);

export interface AccessTokenPayload extends JWTPayload {
  sub: string; // user id
  email: string;
  plan: string;
  banned: boolean;
  sessionId: string;
}

export interface RefreshTokenPayload extends JWTPayload {
  sub: string;
  sessionId: string;
}

export async function signAccessToken(payload: Omit<AccessTokenPayload, 'iat' | 'exp'>): Promise<string> {
  return new SignJWT(payload as JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(ACCESS_SECRET);
}

export async function signRefreshToken(payload: Omit<RefreshTokenPayload, 'iat' | 'exp'>): Promise<string> {
  return new SignJWT(payload as JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(REFRESH_SECRET);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, ACCESS_SECRET);
  return payload as AccessTokenPayload;
}

export async function verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
  const { payload } = await jwtVerify(token, REFRESH_SECRET);
  return payload as RefreshTokenPayload;
}
