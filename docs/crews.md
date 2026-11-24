# Crews

A job passes through four crews. Each one is an agent run with its own instructions and its own tool permissions, prepared by the agent engine. The instructions and the permissions are the same whichever engine runs them: they live in the core, and an engine such as [`@anbiq/engine-claude-code`](../packages/engine-claude-code) only translates the permissions into its agent's own settings.

| Crew   | Job                                                                                                    | Can change code |
| ------ | ------------------------------------------------------------------------------------------------------ | --------------- |
| spec   | Turns the request into 3 to 8 testable acceptance criteria. Asks one question in the thread if unclear | no              |
| build  | Smallest safe change that meets the criteria, tests first, runs the project's verify commands          | yes             |
| qa     | Proves each criterion with a test, looks for untested branches, does a security pass on the diff       | adds tests      |
| review | Re-runs the tests, tries to break the change, checks it against the project's own rules                | no              |

The spec crew's criteria are posted on the job's issue and handed to every later crew, so everyone is held to the same definition of done.

## The fast lane

Four crews is a lot for a typo. A project can name its low-risk files in `anbiq.yml`:

```yaml
policy:
  fast_lane:
    paths: ['**/*.md', 'docs/**']
    max_changed_lines: 200
```

- **QA is skipped** when a job's pull request only touches those paths and changes no more than `max_changed_lines` lines. The factory decides this from the pull request's files after every build, never from how the request is worded, so a revision that starts touching code gets QA again. A renamed file counts under both its old and new name.
- **The spec crew is skipped** when the request starts with `quick:`, for example `quick: fix the typo in the README`. The build crew then works from the request itself. If the change turns out not to qualify, QA runs as usual and the thread is told.
- The review crew always runs, and a person still approves the merge.

Without `fast_lane`, every job runs every stage and `quick:` is an ordinary request.

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
