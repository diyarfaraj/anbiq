import { describe, expect, it } from 'vitest';
import { fastLaneVerdict, matchesGlob } from './fast-lane.js';

const lane = { paths: ['*.md', 'docs/**'], max_changed_lines: 50 };

describe('matchesGlob', () => {
  it.each([
    ['README.md', '*.md', true],
    ['packages/core/README.md', '*.md', false],
    ['packages/core/README.md', '**/*.md', true],
    ['README.md', '**/*.md', true],
    ['docs/deploy.md', 'docs/**', true],
    ['docs/img/board.png', 'docs/**', true],
    ['src/docs/x.ts', 'docs/**', false],
    ['docs', 'docs/**', false],
    ['a.mdx', '*.md', false],
    ['xREADME.md', 'README.md', false],
    ['READMExmd', 'README.md', false],
    ['a1.txt', 'a?.txt', true],
    ['a/1.txt', 'a?1.txt', false],
    ['src/(group)/page.md', 'src/(group)/*.md', true],
  ])('%j against %j is %j', (path, pattern, expected) => {
    expect(matchesGlob(path, pattern)).toBe(expected);
  });
});

describe('fastLaneVerdict', () => {
  it('lets a small change through when every file is on a fast-lane path', () => {
    expect(
      fastLaneVerdict(
        [
          { path: 'README.md', changedLines: 7 },
          { path: 'docs/deploy.md', changedLines: 3 },
        ],
        lane,
      ),
    ).toEqual({ ok: true, files: 2, changedLines: 10 });
  });

  it('refuses when any file is outside the fast-lane paths', () => {
    expect(
      fastLaneVerdict(
        [
          { path: 'README.md', changedLines: 1 },
          { path: 'src/app.ts', changedLines: 1 },
        ],
        lane,
      ),
    ).toEqual({ ok: false, reason: 'it touches src/app.ts' });
  });

  it('refuses a file moved in from outside: the rename removes it from where it was', () => {
    expect(
      fastLaneVerdict([{ path: 'docs/app.md', previousPath: 'src/app.ts', changedLines: 0 }], lane),
    ).toEqual({ ok: false, reason: 'it touches src/app.ts' });
  });

  it('refuses a change over the line limit, and allows one exactly at it', () => {
    expect(fastLaneVerdict([{ path: 'README.md', changedLines: 50 }], lane).ok).toBe(true);
    expect(fastLaneVerdict([{ path: 'README.md', changedLines: 51 }], lane)).toEqual({
      ok: false,
      reason: 'it changes 51 lines, over the limit of 50',
    });
  });

  it('refuses an empty change', () => {
    expect(fastLaneVerdict([], lane)).toEqual({ ok: false, reason: 'the change is empty' });
  });
});
