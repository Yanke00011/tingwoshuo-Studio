import { SignJWT, importPKCS8 } from 'jose';

export interface GitHubEnv {
  GITHUB_APP_ID: string;
  GITHUB_INSTALLATION_ID: string;
  GITHUB_PRIVATE_KEY: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_BASE_BRANCH: string;
}

export class GitHubError extends Error {
  constructor(message: string, readonly status = 502) { super(message); this.name = 'GitHubError'; }
}

async function installationToken(env: GitHubEnv): Promise<string> {
  if (!env.GITHUB_APP_ID || !env.GITHUB_INSTALLATION_ID || !env.GITHUB_PRIVATE_KEY) throw new GitHubError('GitHub App secrets are not configured', 503);
  const key = await importPKCS8(env.GITHUB_PRIVATE_KEY.replace(/\\n/g, '\n'), 'RS256');
  const now = Math.floor(Date.now() / 1000);
  const appJwt = await new SignJWT({}).setProtectedHeader({ alg: 'RS256', typ: 'JWT' }).setIssuer(env.GITHUB_APP_ID).setIssuedAt(now - 30).setExpirationTime(now + 8 * 60).sign(key);
  const response = await fetch(`https://api.github.com/app/installations/${encodeURIComponent(env.GITHUB_INSTALLATION_ID)}/access_tokens`, {
    method: 'POST', headers: { Authorization: `Bearer ${appJwt}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'TingWoShuo-Studio' }
  });
  if (!response.ok) throw new GitHubError(`GitHub App token exchange failed (${response.status})`, response.status);
  return String((await response.json() as { token: string }).token);
}

export async function githubRequest(env: GitHubEnv, path: string, init: RequestInit = {}): Promise<Response> {
  const token = await installationToken(env);
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'TingWoShuo-Studio', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new GitHubError(`GitHub API returned ${response.status}: ${text.slice(0, 250)}`, response.status);
  }
  return response;
}

export function repoPath(path: string): string {
  if (!/^src\/content\/(?:life|tech)\/[\p{L}\p{N}._-]+\.mdx?$/u.test(path) || path.includes('..')) throw new Error('Only Markdown articles in the approved content folders can be published');
  return path;
}
