import { createSign } from 'node:crypto';

/** Supplies a bearer token for GitHub's API. */
export interface TokenProvider {
  token(): Promise<string>;
}

/** A fixed token. For tests and local experiments; production uses a GitHub App. */
export function staticToken(token: string): TokenProvider {
  return { token: async () => token };
}

export interface GitHubAppOptions {
  appId: string;
  /** The app's private key in PEM form. */
  privateKey: string;
  installationId: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  now?: () => Date;
}

/** Renew a cached installation token this long before GitHub expires it. */
const RENEW_BEFORE_MS = 5 * 60 * 1000;

/**
 * Short-lived installation tokens for a GitHub App. Tokens last an hour, are scoped to the
 * repositories the app is installed on, and carry only the permissions the app was granted.
 */
export class GitHubAppAuth implements TokenProvider {
  private cached: { token: string; expiresAt: number } | undefined;
  private readonly fetch: typeof fetch;
  private readonly now: () => Date;

  constructor(private readonly options: GitHubAppOptions) {
    this.fetch = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async token(): Promise<string> {
    if (this.cached && this.cached.expiresAt - RENEW_BEFORE_MS > this.now().getTime()) {
      return this.cached.token;
    }
    const baseUrl = this.options.baseUrl ?? 'https://api.github.com';
    const response = await this.fetch(
      `${baseUrl}/app/installations/${encodeURIComponent(this.options.installationId)}/access_tokens`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.appJwt()}`,
          accept: 'application/vnd.github+json',
          'user-agent': 'anbiq',
        },
      },
    );
    const body = (await response.json()) as {
      token?: string;
      expires_at?: string;
      message?: string;
    };
    if (!response.ok || !body.token || !body.expires_at) {
      throw new Error(
        `GitHub App token request failed: ${body.message ?? `HTTP ${response.status}`}`,
      );
    }
    this.cached = { token: body.token, expiresAt: Date.parse(body.expires_at) };
    return body.token;
  }

  /** The app's own JWT, valid for nine minutes, used only to request installation tokens. */
  appJwt(): string {
    const issuedAt = Math.floor(this.now().getTime() / 1000) - 60;
    const header = encode({ alg: 'RS256', typ: 'JWT' });
    const payload = encode({ iat: issuedAt, exp: issuedAt + 540, iss: this.options.appId });
    const signature = createSign('RSA-SHA256')
      .update(`${header}.${payload}`)
      .sign(this.options.privateKey)
      .toString('base64url');
    return `${header}.${payload}.${signature}`;
  }
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
