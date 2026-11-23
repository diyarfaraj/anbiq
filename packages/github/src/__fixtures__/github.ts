/** An in-memory stand-in for the parts of GitHub's REST API the adapters use. */
export function fakeGitHub() {
  let nextNumber = 1;
  let nextCommentId = 1000;
  const issues = new Map<number, { title: string; body: string; labels: string[] }>();
  const comments = new Map<number, { id: number; issue: number; body: string }>();
  const pulls = new Map<
    number,
    { head: string; base: string; title: string; sha: string; merged: boolean }
  >();
  const checks = new Map<string, { status: string; conclusion: string | null }[]>();
  const statuses = new Map<string, string[]>();
  const requests: { method: string; path: string; auth: string | undefined }[] = [];

  const json = (status: number, body: unknown) =>
    new Response(body === undefined ? '' : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const path = url.pathname.replace(/^\/repos\/[^/]+\/[^/]+/, '');
    requests.push({ method, path: url.pathname, auth: headers.authorization });
    const page = Number(url.searchParams.get('page') ?? '1');
    const perPage = Number(url.searchParams.get('per_page') ?? '30');
    let m: RegExpExecArray | null;

    if (
      method === 'POST' &&
      (m = /^\/app\/installations\/(\w+)\/access_tokens$/.exec(url.pathname))
    ) {
      return json(201, { token: `ghs_installation_${m[1]}`, expires_at: '2026-11-24T10:00:00Z' });
    }
    if (method === 'POST' && path === '/issues') {
      const number = nextNumber++;
      issues.set(number, {
        title: String(body.title),
        body: String(body.body),
        labels: (body.labels as string[]) ?? [],
      });
      return json(201, { number, html_url: `https://github.test/o/r/issues/${number}` });
    }
    if ((m = /^\/issues\/(\d+)\/comments$/.exec(path))) {
      const issue = Number(m[1]);
      if (method === 'POST') {
        const id = nextCommentId++;
        comments.set(id, { id, issue, body: String(body.body) });
        return json(201, { id, body: body.body });
      }
      const all = [...comments.values()]
        .filter((c) => c.issue === issue)
        .sort((a, b) => a.id - b.id);
      return json(200, all.slice((page - 1) * perPage, page * perPage));
    }
    if (method === 'PATCH' && (m = /^\/issues\/comments\/(\d+)$/.exec(path))) {
      const comment = comments.get(Number(m[1]));
      if (!comment) return json(404, { message: 'Not Found' });
      comment.body = String(body.body);
      return json(200, comment);
    }
    if ((m = /^\/issues\/(\d+)\/labels$/.exec(path))) {
      const issue = issues.get(Number(m[1]));
      if (!issue) return json(404, { message: 'Not Found' });
      if (method === 'PUT') issue.labels = body.labels as string[];
      return json(
        200,
        issue.labels.map((name) => ({ name })),
      );
    }
    if (method === 'POST' && path === '/pulls') {
      const number = nextNumber++;
      pulls.set(number, {
        head: String(body.head),
        base: String(body.base),
        title: String(body.title),
        sha: 'sha-0',
        merged: false,
      });
      return json(201, {
        number,
        html_url: `https://github.test/o/r/pull/${number}`,
        head: { sha: 'sha-0' },
      });
    }
    if (method === 'PUT' && (m = /^\/pulls\/(\d+)\/merge$/.exec(path))) {
      const pr = pulls.get(Number(m[1]));
      if (!pr) return json(404, { message: 'Not Found' });
      if (body.sha !== pr.sha)
        return json(409, { message: 'Head branch was modified. Review and try the merge again.' });
      pr.merged = true;
      return json(200, { merged: true, sha: 'merge-sha' });
    }
    if (method === 'GET' && (m = /^\/pulls\/(\d+)$/.exec(path))) {
      const number = Number(m[1]);
      const pr = pulls.get(number);
      if (!pr) return json(404, { message: 'Not Found' });
      return json(200, {
        number,
        html_url: `https://github.test/o/r/pull/${number}`,
        head: { sha: pr.sha },
      });
    }
    if ((m = /^\/commits\/([^/]+)\/check-runs$/.exec(path))) {
      const runs = checks.get(m[1]!) ?? [];
      return json(200, { total_count: runs.length, check_runs: runs });
    }
    if ((m = /^\/commits\/([^/]+)\/status$/.exec(path))) {
      const states = statuses.get(m[1]!) ?? [];
      const state =
        states.includes('failure') || states.includes('error')
          ? 'failure'
          : states.includes('pending')
            ? 'pending'
            : 'success';
      return json(200, {
        state: states.length === 0 ? 'pending' : state,
        total_count: states.length,
      });
    }
    return json(404, { message: `fake GitHub has no route for ${method} ${url.pathname}` });
  }) as typeof fetch;

  return {
    fetch: fetchImpl,
    issues,
    comments,
    pulls,
    requests,
    /** A push to the pull request's branch. */
    push(prNumber: number, sha: string) {
      const pr = pulls.get(prNumber);
      if (!pr) throw new Error(`no pull request ${prNumber}`);
      pr.sha = sha;
    },
    setChecks(sha: string, runs: { status: string; conclusion: string | null }[]) {
      checks.set(sha, runs);
    },
    setStatuses(sha: string, states: string[]) {
      statuses.set(sha, states);
    },
  };
}
