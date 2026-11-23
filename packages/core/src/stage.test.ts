import { describe, expect, it } from 'vitest';
import { STAGES, isStage } from './stage.js';

describe('isStage', () => {
  it('accepts every declared stage', () => {
    for (const stage of STAGES) {
      expect(isStage(stage)).toBe(true);
    }
  });

  it('rejects anything else', () => {
    for (const value of ['', 'Build', 'deploying', 42, null, undefined, {}]) {
      expect(isStage(value)).toBe(false);
    }
  });
});
