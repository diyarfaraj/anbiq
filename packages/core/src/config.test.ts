import { describe, expect, it } from 'vitest';
import { parseConfig } from './config.js';
import { VALID_YAML } from './__fixtures__/config.js';

function errorsFor(yaml: string): string[] {
  const result = parseConfig(yaml);
  if (result.ok) throw new Error('expected the config to be rejected');
  return result.errors;
}

describe('parseConfig', () => {
  it('accepts a valid config and fills in defaults', () => {
    const result = parseConfig(VALID_YAML);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.enabled).toBe(true);
    expect(result.config.engine.max_turns).toBe(60);
    expect(result.config.policy.merge).toBe('human');
    expect(result.config.policy.max_revisions).toBe(3);
  });

  it('fills in the whole policy block when it is left out', () => {
    const result = parseConfig(VALID_YAML.replace(/policy:\n( {2}.*\n)+/, ''));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.policy.deploy_environments).toEqual(['production']);
    expect(result.config.policy.confirm_commands).toEqual([]);
  });

  it('reports YAML syntax errors', () => {
    expect(errorsFor('project: [unclosed')[0]).toMatch(/not valid YAML/);
  });

  it('rejects an empty file', () => {
    expect(errorsFor('')[0]).toMatch(/^\(root\):/);
  });

  it('refuses to let agents merge or deploy', () => {
    const errors = errorsFor(VALID_YAML.replace('policy:\n', 'policy:\n  merge: agent\n'));
    expect(errors.some((e) => e.startsWith('policy.merge:'))).toBe(true);
  });

  it('requires budgets, so there is no unlimited setup', () => {
    const errors = errorsFor(VALID_YAML.replace(/budgets:\n( {2}.*\n)+/, ''));
    expect(errors.some((e) => e.startsWith('budgets:'))).toBe(true);
  });

  it('rejects identities for taps that are not configured', () => {
    const errors = errorsFor(VALID_YAML.replace('slack: U034GHIJKL', 'teams: U034GHIJKL'));
    expect(errors).toContainEqual(
      expect.stringMatching(/^people\.1\.ids\.teams: unknown tap "teams"/),
    );
  });

  it('rejects the same identity on two people', () => {
    const errors = errorsFor(VALID_YAML.replace('slack: U034GHIJKL', 'slack: U012ABCDEF'));
    expect(errors).toContainEqual(expect.stringMatching(/already belongs to Owner/));
  });

  it('requires at least one approver', () => {
    const errors = errorsFor(
      VALID_YAML.replace('roles: [requester, approver]', 'roles: [requester]'),
    );
    expect(errors).toContainEqual('people: at least one person needs the approver role');
  });

  it('rejects unknown keys instead of ignoring typos', () => {
    const errors = errorsFor(`${VALID_YAML}\nenabeld: false\n`);
    expect(errors.some((e) => e.includes('enabeld'))).toBe(true);
  });
});
