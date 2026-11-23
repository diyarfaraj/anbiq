import { describeGitHostConformance, describeTrackerConformance } from '@anbiq/testkit';
import { staticToken } from './auth.js';
import { GitHubGitHost } from './git-host.js';
import { GitHubTracker } from './tracker.js';
import { fakeGitHub } from './__fixtures__/github.js';

describeTrackerConformance('GitHubTracker', () => {
  const github = fakeGitHub();
  return new GitHubTracker({ owner: 'o', repo: 'r', auth: staticToken('t'), fetch: github.fetch });
});

describeGitHostConformance('GitHubGitHost', () => {
  const github = fakeGitHub();
  const gitHost = new GitHubGitHost({
    owner: 'o',
    repo: 'r',
    baseBranch: 'main',
    auth: staticToken('t'),
    fetch: github.fetch,
  });
  return { gitHost, push: async (pr, sha) => github.push(Number(pr.id), sha) };
});
