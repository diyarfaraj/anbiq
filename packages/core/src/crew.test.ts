import { describe, expect, it } from 'vitest';
import { FORBIDDEN, crewPermissions } from './crew.js';

const verify = ['pnpm test', 'pnpm lint'];

describe('crewPermissions', () => {
  it('lets the spec crew only read', () => {
    expect(crewPermissions('spec', verify)).toEqual({
      editCode: false,
      commands: [],
      commit: false,
      readHistory: false,
    });
  });

  it('lets build and QA edit, run the verify commands and commit', () => {
    for (const stage of ['build', 'qa'] as const) {
      expect(crewPermissions(stage, verify)).toEqual({
        editCode: true,
        commands: verify,
        commit: true,
        readHistory: true,
      });
    }
  });

  it('lets the review crew run the verify commands and read the history, without changing code', () => {
    expect(crewPermissions('review', verify)).toEqual({
      editCode: false,
      commands: verify,
      commit: false,
      readHistory: true,
    });
  });
});

describe('FORBIDDEN', () => {
  it('covers pushing, the network, local secrets and CI for every engine', () => {
    expect(FORBIDDEN.commands).toEqual(expect.arrayContaining(['git push', 'curl', 'ssh']));
    expect(FORBIDDEN.network).toBe(true);
    expect(FORBIDDEN.readPaths).toContain('.env');
    expect(FORBIDDEN.writePaths).toContain('.github/workflows/**');
  });
});
