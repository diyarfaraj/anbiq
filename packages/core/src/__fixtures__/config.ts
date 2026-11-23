import { parseConfig, type AnbiqConfig } from '../config.js';

export const VALID_YAML = `
project: acme-web
taps:
  slack:
    channel: '#factory'
  whatsapp-twilio:
    numbers: ['+15550100']
people:
  - name: Owner
    ids:
      slack: U012ABCDEF
      whatsapp-twilio: '+15550123'
    roles: [requester, approver]
  - name: Teammate
    ids:
      slack: U034GHIJKL
    roles: [requester]
tracker: github-issues
git_host: github
runner: github-actions
engine:
  id: claude-code
checks:
  verify: ['pnpm test']
policy:
  confirm_commands: ['deploy production']
  deploy_environments: [staging, production]
budgets:
  usd_per_day: 25
  jobs_per_day: 10
  concurrent_jobs: 1
`;

export function validConfig(overrides: Partial<AnbiqConfig> = {}): AnbiqConfig {
  const result = parseConfig(VALID_YAML);
  if (!result.ok) {
    throw new Error(`fixture config is invalid: ${result.errors.join('; ')}`);
  }
  return { ...result.config, ...overrides };
}
