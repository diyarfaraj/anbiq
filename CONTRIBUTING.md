# Contributing to Anbiq

Thanks for your interest. Anbiq is in its design phase, so the most valuable contributions right now are ideas, questions and criticism of the design.

## Ways to help

- **Design feedback.** Read [docs/architecture.md](docs/architecture.md) and open an issue if something is unclear, missing or wrong.
- **Adapter interest.** If you want a tap, tracker, git host or runner that is not on the roadmap, open an issue describing the platform and its constraints (authentication, message limits, threading, reply windows).
- **Security review.** If you spot a way the design could let an agent or an outsider do more than intended, please report it privately (see [SECURITY.md](SECURITY.md)).

## Before you write code

Open or comment on an issue first, so we agree on the approach before you spend time on it. Once code exists:

- Keep each pull request focused on one change, with tests for the behaviour it adds or fixes.
- Every adapter must pass the shared conformance tests for its slot.
- Describe what you tested and what you did not.
- Do not add a dependency without saying why it is needed.

## Development

You need Node.js 22 or newer and pnpm (the version is pinned in `package.json`; `corepack enable` picks it up).

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
```

CI runs the same commands on Node 22 and 24 for every pull request.

## Code of conduct

Be respectful and assume good faith. Harassment and personal attacks are not tolerated, and the maintainer may remove comments, issues or contributors that break this rule.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
