import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface AuthEnv {
  ACCESS_TEAM?: string;
  ACCESS_AUD?: string;
  ACCESS_ALLOWED_EMAIL?: string;
  ENVIRONMENT?: string;
  LOCAL_DEV_EMAIL?: string;
}

export class AuthError extends Error {
  constructor(message = 'Access authentication required') { super(message); this.name = 'AuthError'; }
}

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function authenticatedEmail(request: Request, env: AuthEnv): Promise<string> {
  // Deliberately confined to loopback development. Production never accepts an
  // application supplied identity header in place of an Access-signed token.
  if (env.ENVIRONMENT === 'development' && new URL(request.url).hostname === '127.0.0.1' && env.LOCAL_DEV_EMAIL) {
    return env.LOCAL_DEV_EMAIL;
  }
  if (!env.ACCESS_TEAM || !env.ACCESS_AUD || !env.ACCESS_ALLOWED_EMAIL) throw new AuthError('Studio authentication is not configured');
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) throw new AuthError();
  const issuer = `https://${env.ACCESS_TEAM}.cloudflareaccess.com`;
  let jwks = keySets.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    keySets.set(issuer, jwks);
  }
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer, audience: env.ACCESS_AUD, algorithms: ['RS256'], clockTolerance: 5 });
    if (typeof payload.email !== 'string' || payload.email.toLowerCase() !== env.ACCESS_ALLOWED_EMAIL.toLowerCase()) throw new AuthError('This identity is not allowlisted');
    return payload.email;
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError('Invalid or expired Cloudflare Access JWT');
  }
}

export function verifyWriteOrigin(request: Request, csrfCookie: string | null, submittedToken: string | null, expectedOrigin = new URL(request.url).origin): void {
  const origin = request.headers.get('Origin');
  if (!origin || origin !== expectedOrigin) throw new AuthError('Invalid request origin');
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site') throw new AuthError('Cross-site write rejected');
  if (!csrfCookie || !submittedToken || csrfCookie.length < 32 || csrfCookie !== submittedToken) throw new AuthError('CSRF validation failed');
}

export function parseCookies(header: string | null): Map<string, string> {
  const result = new Map<string, string>();
  for (const part of (header || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) result.set(part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim()));
  }
  return result;
}
