# Crews

A job passes through four crews. Each one is an agent run with its own instructions and its own tool permissions, prepared by the agent engine (see [`@anbiq/engine-claude-code`](../packages/engine-claude-code)).

| Crew   | Job                                                                                                    | Can change code |
| ------ | ------------------------------------------------------------------------------------------------------ | --------------- |
| spec   | Turns the request into 3 to 8 testable acceptance criteria. Asks one question in the thread if unclear | no              |
| build  | Smallest safe change that meets the criteria, tests first, runs the project's verify commands          | yes             |
| qa     | Proves each criterion with a test, looks for untested branches, does a security pass on the diff       | adds tests      |
| review | Re-runs the tests, tries to break the change, checks it against the project's own rules                | no              |

The spec crew's criteria are posted on the job's issue and handed to every later crew, so everyone is held to the same definition of done.

## Loops and limits

- QA or review failing sends the job back to build with their findings, up to `policy.max_bounces` times. After that the job is handed to a person.
- `revise: <feedback>` from a person sends an awaiting-approval job back to build, up to `policy.max_revisions` times. After that the factory replies that a person needs to take over.
- A crew that needs an answer stops with one question. The job is blocked until someone replies in the thread, and the answer goes to the same crew.

## Your project's own instructions

Put extra instructions in the repository the factory works on:

- `.anbiq/crews/all.md` for every crew;
- `.anbiq/crews/spec.md`, `build.md`, `qa.md` or `review.md` for one crew.

These are files in your repository, so they are reviewed and merged like any code. They add to the built-in instructions and cannot loosen the built-in rules or tool permissions.

## Credits

The crew design draws on ideas from [super-board](https://github.com/EricTechPro/super-board) by Eric Tech and on Matt Pocock's published Claude Code skills, in particular writing acceptance criteria before code and having review try counterexamples. No text or code is copied from either. If a future crew includes borrowed MIT-licensed material, its copyright and license notice will be kept next to it and listed here.
