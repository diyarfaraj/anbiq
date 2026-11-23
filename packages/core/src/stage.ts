export const STAGES = [
  'intake',
  'spec',
  'build',
  'qa',
  'review',
  'awaiting-approval',
  'merged',
  'deployed',
  'blocked',
  'cancelled',
] as const;

export type Stage = (typeof STAGES)[number];

export function isStage(value: unknown): value is Stage {
  return typeof value === 'string' && (STAGES as readonly string[]).includes(value);
}
