import { describe, expect, it } from 'vitest';
import {
  FORBIDDEN,
  RESULT_FILE,
  crewPermissions,
  parseConfig,
  type AnbiqConfig,
  type CrewStage,
} from '@anbiq/core';
import { FORBIDDEN_RULES, OpenCodeEngine, permissionRules, type PermissionRule } from './index.js';

function configWith(engine: string): AnbiqConfig {
  const parsed = parseConfig(`
project: acme
taps: { slack: {} }
people:
  - name: Owner
    ids: { slack: U1 }
    roles: [requester, approver]
tracker: github-issues
git_host: github
runner: github-actions
engine: ${engine}
checks: { verify: ['pnpm test', 'pnpm lint'] }
budgets: { jobs_per_day: 10, concurrent_jobs: 1 }
`);
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  return parsed.config;
}

const config = configWith('{ id: opencode, model: openai/some-model, max_turns: 40 }');
const engine = new OpenCodeEngine();
const rules = (stage: CrewStage) => permissionRules(crewPermissions(stage, ['pnpm test']));

/**
 * OpenCode's own matching, as its documentation states it and as observed in version 2.4.1:
 * "*" is any run of characters including "/", the whole value must match, a pattern ending in
 * " *" also matches the bare command, and the last matching rule wins.
 */
function matches(pattern: string, value: string): boolean {
  const body = pattern.endsWith(' *') ? `${escape(pattern.slice(0, -2))}( .*)?` : escape(pattern);
  return new RegExp(`^${body}$`, 's').test(value);
}
function escape(pattern: string): string {
  return pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('*', '.*')
    .replaceAll('?', '.');
}
function effect(ruleset: PermissionRule[], action: string, resource: string): string {
  const last = ruleset.findLast(
    (rule) => (rule.action === '*' || rule.action === action) && matches(rule.resource, resource),
  );
  return last?.effect ?? 'ask';
}

describe('OpenCodeEngine', () => {
  it('prepares an OpenCode config with the rules, the step limit and the model', () => {
    const invocation = engine.prepare({ stage: 'build', request: 'Add a button', config });
    expect(invocation).toMatchObject({
      engine: 'opencode',
      maxTurns: 40,
      model: 'openai/some-model',
    });
    expect(invocation.settings).toEqual({
      permissions: permissionRules(crewPermissions('build', ['pnpm test', 'pnpm lint'])),
      agents: { build: { steps: 40 } },
    });
  });

  it('uses the same prompt as every other engine', () => {
    const prompt = engine.prepare({ stage: 'qa', request: 'x', config }).prompt;
    expect(prompt).toMatch(/^You are the QA crew/);
    expect(prompt).toContain(RESULT_FILE);
  });

  it('refuses to run without a model, since OpenCode has no default provider', () => {
    const noModel = configWith('{ id: opencode }');
    expect(() => engine.prepare({ stage: 'spec', request: 'x', config: noModel })).toThrow(
      /engine\.model/,
    );
  });
});

describe('permissionRules', () => {
  it('never leaves anything to ask about, whatever the action', () => {
    for (const stage of ['spec', 'build', 'qa', 'review'] as const) {
      expect(rules(stage)[0]).toEqual({ action: '*', resource: '*', effect: 'deny' });
      expect(effect(rules(stage), 'subagent', 'general')).toBe('deny');
      expect(effect(rules(stage), 'some_mcp_tool', 'x')).toBe('deny');
      expect(rules(stage).some((rule) => (rule.effect as string) === 'ask')).toBe(false);
    }
  });

  it('lets every crew read the repository and write its result', () => {
    for (const stage of ['spec', 'build', 'qa', 'review'] as const) {
      expect(effect(rules(stage), 'read', 'src/app.ts')).toBe('allow');
      expect(effect(rules(stage), 'grep', '*')).toBe('allow');
      expect(effect(rules(stage), 'edit', RESULT_FILE)).toBe('allow');
    }
  });

  it('keeps the spec and review crews from editing code', () => {
    for (const stage of ['spec', 'review'] as const) {
      expect(effect(rules(stage), 'edit', 'src/app.ts')).toBe('deny');
      expect(effect(rules(stage), 'shell', 'git commit -m x')).toBe('deny');
    }
  });

  it('gives the spec crew no shell at all', () => {
    expect(rules('spec').some((rule) => rule.action === 'shell' && rule.effect === 'allow')).toBe(
      false,
    );
  });

  it('lets build and QA edit, run the verify commands and commit', () => {
    for (const stage of ['build', 'qa'] as const) {
      expect(effect(rules(stage), 'edit', 'src/app.ts')).toBe('allow');
      expect(effect(rules(stage), 'shell', 'pnpm test')).toBe('allow');
      expect(effect(rules(stage), 'shell', 'pnpm test --watch=false')).toBe('allow');
      expect(effect(rules(stage), 'shell', 'git add -A')).toBe('allow');
      expect(effect(rules(stage), 'shell', 'git commit -m "x"')).toBe('allow');
      expect(effect(rules(stage), 'shell', 'git status')).toBe('allow');
    }
  });

  it('lets the review crew run the verify commands and read the history', () => {
    expect(effect(rules('review'), 'shell', 'pnpm test')).toBe('allow');
    expect(effect(rules('review'), 'shell', 'git diff main...HEAD')).toBe('allow');
    expect(effect(rules('review'), 'shell', 'git log -5')).toBe('allow');
  });

  it('denies a command that only starts like an allowed one', () => {
    expect(effect(rules('build'), 'shell', 'pnpm testx')).toBe('deny');
    expect(effect(rules('build'), 'shell', 'pnpm publish')).toBe('deny');
    expect(effect(rules('build'), 'shell', 'git -c core.pager=cat log')).toBe('deny');
  });

  it('denies everything the core forbids, for the crew with the widest permissions', () => {
    const build = rules('build');
    for (const command of FORBIDDEN.commands) {
      expect(effect(build, 'shell', command)).toBe('deny');
      expect(effect(build, 'shell', `${command} anything`)).toBe('deny');
    }
    for (const command of FORBIDDEN.bareCommands) {
      expect(effect(build, 'shell', command)).toBe('deny');
    }
    expect(effect(build, 'webfetch', 'https://example.com')).toBe('deny');
    expect(effect(build, 'websearch', 'anything')).toBe('deny');
    expect(effect(build, 'external_directory', '/etc/passwd')).toBe('deny');
    for (const path of ['.env', '.env.local', 'apps/web/.env', 'apps/web/.env.production']) {
      expect(effect(build, 'read', path)).toBe('deny');
    }
    expect(effect(build, 'read', '.env.example.md')).toBe('deny');
    expect(effect(build, 'read', 'src/environment.ts')).toBe('allow');
    expect(effect(build, 'edit', '.github/workflows/ci.yml')).toBe('deny');
    expect(effect(build, 'edit', '.github/workflows/nested/ci.yml')).toBe('deny');
    expect(effect(build, 'edit', '.github/CODEOWNERS')).toBe('allow');
  });

  it('puts the forbidden rules last, where no allow rule can override them', () => {
    for (const stage of ['spec', 'build', 'qa', 'review'] as const) {
      expect(rules(stage).slice(-FORBIDDEN_RULES.length)).toEqual(FORBIDDEN_RULES);
    }
    expect(FORBIDDEN_RULES.every((rule) => rule.effect === 'deny')).toBe(true);
  });

  it('still forbids a verify command that is itself forbidden', () => {
    const odd = permissionRules(crewPermissions('build', ['curl https://example.com']));
    expect(effect(odd, 'shell', 'curl https://example.com')).toBe('deny');
  });
});
