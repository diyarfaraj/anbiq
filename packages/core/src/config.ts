import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

export const ROLES = ['requester', 'approver'] as const;
export type Role = (typeof ROLES)[number];

const text = z.string().trim().min(1);

const personSchema = z
  .object({
    name: text,
    ids: z
      .record(text, text)
      .refine((ids) => Object.keys(ids).length > 0, 'needs at least one tap identity'),
    roles: z.array(z.enum(ROLES)).min(1),
  })
  .strict();

const engineSchema = z
  .object({
    id: text,
    model: text.optional(),
    max_turns: z.number().int().positive().default(60),
    timeout_minutes: z.number().int().positive().default(60),
  })
  .strict();

const policySchema = z
  .object({
    merge: z.literal('human').default('human'),
    deploy: z.literal('human').default('human'),
    human_review_paths: z.array(text).default([]),
    confirm_commands: z.array(text).default([]),
    deploy_environments: z.array(text).min(1).default(['production']),
    max_revisions: z.number().int().min(0).default(3),
    /** How many times QA or review may send work back to build before a person takes over. */
    max_bounces: z.number().int().min(0).default(3),
    /**
     * Low-risk changes that may take fewer stages. Left out, every job runs every stage.
     * Whether a change qualifies is decided from the files it touches, never from the request.
     */
    fast_lane: z
      .object({
        paths: z.array(text).min(1),
        max_changed_lines: z.number().int().positive().default(200),
      })
      .strict()
      .optional(),
  })
  .strict();

const budgetsSchema = z
  .object({
    /**
     * Left out, spend is not limited: use that for an engine that does not report what a run
     * cost. The job limits below always apply.
     */
    usd_per_day: z.number().positive().optional(),
    jobs_per_day: z.number().int().positive(),
    concurrent_jobs: z.number().int().positive(),
  })
  .strict();

export const configSchema = z
  .object({
    project: text,
    taps: z
      .record(text, z.record(z.string(), z.unknown()))
      .refine((taps) => Object.keys(taps).length > 0, 'needs at least one tap'),
    people: z.array(personSchema).min(1),
    tracker: text,
    git_host: text,
    runner: text,
    engine: engineSchema,
    checks: z.object({ verify: z.array(text).min(1) }).strict(),
    policy: policySchema.prefault({}),
    budgets: budgetsSchema,
    enabled: z.boolean().default(true),
  })
  .strict()
  .superRefine((config, ctx) => {
    const taps = Object.keys(config.taps);
    const owners = new Map<string, string>();

    config.people.forEach((person, index) => {
      for (const [tap, id] of Object.entries(person.ids)) {
        if (!taps.includes(tap)) {
          ctx.addIssue({
            code: 'custom',
            path: ['people', index, 'ids', tap],
            message: `unknown tap "${tap}"; configured taps: ${taps.join(', ')}`,
          });
        }
        const key = `${tap}\u0000${id}`;
        const owner = owners.get(key);
        if (owner !== undefined) {
          ctx.addIssue({
            code: 'custom',
            path: ['people', index, 'ids', tap],
            message: `"${id}" on ${tap} already belongs to ${owner}`,
          });
        }
        owners.set(key, person.name);
      }
    });

    if (!config.people.some((person) => person.roles.includes('approver'))) {
      ctx.addIssue({
        code: 'custom',
        path: ['people'],
        message: 'at least one person needs the approver role',
      });
    }
  });

export type AnbiqConfig = z.output<typeof configSchema>;

export type ConfigResult = { ok: true; config: AnbiqConfig } | { ok: false; errors: string[] };

export function parseConfig(source: string): ConfigResult {
  let raw: unknown;
  try {
    raw = parseYaml(source);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, errors: [`anbiq.yml is not valid YAML: ${reason}`] };
  }

  const result = configSchema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map(
        (issue) => `${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`,
      ),
    };
  }
  return { ok: true, config: result.data };
}
