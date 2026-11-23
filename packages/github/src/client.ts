import type { TokenProvider } from './auth.js';

export interface RepositoryOptions {
  owner: string;
  repo: string;
  auth: TokenProvider;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

/** A thin client for one repository's REST API. */
export class GitHubClient {
  private readonly fetch: typeof fetch;
  private readonly baseUrl: string;

  constructor(private readonly options: RepositoryOptions) {
    this.fetch = options.fetch ?? fetch;
    this.baseUrl = options.baseUrl ?? 'https://api.github.com';
  }

  /** Path relative to /repos/{owner}/{repo}. */
  async repo<T>(method: string, path: string, body?: unknown): Promise<T> {
    const { owner, repo } = this.options;
    return this.request<T>(
      method,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${path}`,
      body,
    );
  }

  /** Every page of a list endpoint (100 items per page). */
  async repoList<T>(path: string): Promise<T[]> {
    const items: T[] = [];
    for (let page = 1; ; page++) {
      const separator = path.includes('?') ? '&' : '?';
      const batch = await this.repo<T[]>('GET', `${path}${separator}per_page=100&page=${page}`);
      items.push(...batch);
      if (batch.length < 100) return items;
    }
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${await this.options.auth.token()}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'anbiq',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    const parsed: unknown = text ? JSON.parse(text) : undefined;
    if (!response.ok) {
      const message =
        (parsed as { message?: string } | undefined)?.message ?? `HTTP ${response.status}`;
      throw new GitHubError(response.status, `GitHub ${method} ${path} failed: ${message}`);
    }
    return parsed as T;
  }
}
