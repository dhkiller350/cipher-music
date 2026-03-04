import { NextRequest, NextResponse } from 'next/server';
import { verifyAccessToken, type AccessTokenPayload } from './jwt';
import { supabase } from './supabase';

// ─── CORS helpers ─────────────────────────────────────────────────────────────
// Allowed origins: space/comma-separated list from env var, or same-origin only.
const _allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS || process.env.NEXT_PUBLIC_APP_URL || '')
    .split(/[\s,]+/)
    .map(o => o.trim())
    .filter(Boolean)
);

/**
 * Returns the CORS origin to reflect, or null if the request origin is not allowed.
 * Returns null when neither ALLOWED_ORIGINS nor NEXT_PUBLIC_APP_URL are configured,
 * or when the request origin is not in the configured allowed list.
 * Same-origin requests (no Origin header) don't need a CORS origin header and also return null.
 */
function getAllowedOrigin(request: NextRequest): string | null {
  const origin = request.headers.get('origin');
  if (!origin) return null; // same-origin or non-browser — no CORS header needed
  if (_allowedOrigins.size === 0) return null; // no cross-origin origins configured
  return _allowedOrigins.has(origin) ? origin : null;
}

/**
 * Apply CORS headers to a response so that mobile browsers on a different
 * origin (e.g. a Capacitor/PWA wrapper, or a different subdomain) can reach
 * the API.  Must be called on every response, including error responses.
 */
export function applyCorsHeaders(request: NextRequest, response: NextResponse): NextResponse {
  const origin = getAllowedOrigin(request);
  if (origin) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Credentials', 'true');
    response.headers.set('Vary', 'Origin');
  }
  return response;
}

/**
 * Respond to OPTIONS preflight requests.
 * Returns a 204 response with the required CORS preflight headers, or null
 * if the request is not a preflight.
 */
export function handlePreflight(request: NextRequest): NextResponse | null {
  if (request.method !== 'OPTIONS') return null;
  const origin = getAllowedOrigin(request);
  if (!origin) return new NextResponse(null, { status: 204 });
  const res = new NextResponse(null, { status: 204 });
  res.headers.set('Access-Control-Allow-Origin', origin);
  res.headers.set('Access-Control-Allow-Credentials', 'true');
  res.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Authorization,Content-Type,X-Requested-With');
  res.headers.set('Access-Control-Max-Age', '86400');
  res.headers.set('Vary', 'Origin');
  return res;
}

// ─── Rate limiting (in-memory, per instance) ──────────────────────────────────
const rateLimitWindows = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): boolean {
  const now = Date.now();
  const entry = rateLimitWindows.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitWindows.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  entry.count++;
  if (entry.count > maxRequests) return false;
  return true;
}

export function rateLimitResponse(request: NextRequest, maxReqs: number, windowMs: number): NextResponse | null {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim()
    ?? request.headers.get('x-real-ip')
    ?? 'unknown';
  const key = `rl:${request.nextUrl.pathname}:${ip}`;
  if (!rateLimit(key, maxReqs, windowMs)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  return null;
}

// ─── Extract device fingerprint info ──────────────────────────────────────────
export interface DeviceInfo {
  userAgent: string;
  ip: string;
  region?: string;
}

export function extractDeviceInfo(request: NextRequest): DeviceInfo {
  return {
    userAgent: request.headers.get('user-agent') ?? '',
    ip: request.headers.get('x-forwarded-for')?.split(',')[0].trim()
      ?? request.headers.get('x-real-ip')
      ?? 'unknown',
    region: request.headers.get('cf-ipcountry') ?? undefined,
  };
}

// ─── Auth helpers ──────────────────────────────────────────────────────────────
export function getAccessToken(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);
  return request.cookies.get('access_token')?.value ?? null;
}

export async function validateAccessToken(
  request: NextRequest
): Promise<{ payload: AccessTokenPayload } | { error: NextResponse }> {
  const token = getAccessToken(request);
  if (!token) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  try {
    const payload = await verifyAccessToken(token);
    return { payload };
  } catch {
    return { error: NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 }) };
  }
}

// ─── Maintenance mode check ────────────────────────────────────────────────────
export async function checkMaintenanceMode(isAdmin: boolean): Promise<NextResponse | null> {
  if (isAdmin) return null;
  const { data } = await supabase
    .from('platform_config')
    .select('value')
    .eq('key', 'platform_status')
    .single();
  if (data?.value === 'maintenance') {
    return NextResponse.json(
      { error: 'Platform is under maintenance', maintenance: true },
      { status: 503 }
    );
  }
  return null;
}

// ─── Composed guard helpers ────────────────────────────────────────────────────
export function requireAuth(
  handler: (request: NextRequest, payload: AccessTokenPayload) => Promise<NextResponse>
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    const result = await validateAccessToken(request);
    if ('error' in result) return result.error;
    return handler(request, result.payload);
  };
}

export function requireSubscription(
  handler: (request: NextRequest, payload: AccessTokenPayload) => Promise<NextResponse>
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    const result = await validateAccessToken(request);
    if ('error' in result) return result.error;
    if (result.payload.plan === 'free') {
      return NextResponse.json({ error: 'Subscription required' }, { status: 403 });
    }
    return handler(request, result.payload);
  };
}

export function requireNotBanned(
  handler: (request: NextRequest, payload: AccessTokenPayload) => Promise<NextResponse>
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    const result = await validateAccessToken(request);
    if ('error' in result) return result.error;
    if (result.payload.banned) {
      return NextResponse.json({ error: 'Account is banned' }, { status: 403 });
    }
    return handler(request, result.payload);
  };
}
