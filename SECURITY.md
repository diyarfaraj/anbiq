# Security policy

Anbiq lets coding agents change software on someone's behalf, so security is a design requirement, not a feature.

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's private vulnerability reporting instead: the **Security** tab of this repository, then **Report a vulnerability**. Include what you found, how to reproduce it and what an attacker could achieve. You will get an answer as soon as possible; the project is maintained by one person, so please allow a few days.

## The security model in brief

These rules hold for every module and every configuration. A change that weakens one of them will not be merged.

1. **Only known people can start or approve work.** Every tap verifies the chat platform's signature on each request, and the core only accepts requests and commands from identities on the project's allowlist. Display names are never trusted.
2. **Agents never hold deploy credentials, server access or production data.** The agent's job receives only what it needs to read the repository, run tests and open a pull request.
3. **Agents cannot merge or deploy.** Merging and deploying are separate steps triggered by an explicit human command and checked against policy (for example: all required checks green, the reviewed commit is the one being merged).
4. **Request text is untrusted input.** Messages from chat apps and issue bodies are passed to agents as data inside a fixed instruction template, never as instructions with authority.
5. **Short-lived, narrowly scoped tokens.** Integrations use app installations and short-lived tokens where the platform offers them, not personal access tokens.
6. **Hard limits and a kill switch.** Every project has caps on cost, turns, run time and concurrent jobs, and one setting that stops intake and running jobs.

## Supported versions

Anbiq has no releases yet. Once it does, only the latest release will receive security fixes.
