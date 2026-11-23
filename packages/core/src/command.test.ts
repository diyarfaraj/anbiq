import { describe, expect, it } from 'vitest';
import { commandText, parseCommand, type Command } from './command.js';

function parsed(input: string): Command {
  const result = parseCommand(input);
  if (!result.ok) throw new Error(result.error);
  return result.command;
}

describe('parseCommand', () => {
  it.each([
    ['merge', { type: 'merge' }],
    ['  MERGE  ', { type: 'merge' }],
    ['status', { type: 'status' }],
    ['Cancel', { type: 'cancel' }],
    ['deploy production', { type: 'deploy', environment: 'production' }],
    ['Deploy Staging', { type: 'deploy', environment: 'staging' }],
    ['revise: make the button larger', { type: 'revise', text: 'make the button larger' }],
    ['Revise :  use the brand colour ', { type: 'revise', text: 'use the brand colour' }],
  ])('parses %j', (input, expected) => {
    expect(parsed(input)).toEqual(expected);
  });

  it('treats anything that is not an exact command as a new request', () => {
    expect(parsed('merge the header changes')).toEqual({
      type: 'request',
      text: 'merge the header changes',
    });
    expect(parsed('deploy the new header to staging')).toEqual({
      type: 'request',
      text: 'deploy the new header to staging',
    });
  });

  it('keeps multi-line revise feedback', () => {
    expect(parsed('revise: first\nsecond')).toEqual({ type: 'revise', text: 'first\nsecond' });
  });

  it.each([
    ['', /empty/],
    ['   ', /empty/],
    ['revise:', /needs feedback/],
    ['deploy', /needs an environment/],
  ])('rejects %j', (input, error) => {
    const result = parseCommand(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(error);
  });
});

describe('commandText', () => {
  it('includes the environment for deploys', () => {
    expect(commandText({ type: 'deploy', environment: 'production' })).toBe('deploy production');
    expect(commandText({ type: 'merge' })).toBe('merge');
  });
});
