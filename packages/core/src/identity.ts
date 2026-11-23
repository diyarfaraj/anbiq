import type { AnbiqConfig, Role } from './config.js';

export interface Person {
  name: string;
  roles: readonly Role[];
}

/** Resolves a tap's user ID to a configured person. Display names are never used. */
export function findPerson(config: AnbiqConfig, tap: string, userId: string): Person | undefined {
  const person = config.people.find((candidate) => candidate.ids[tap] === userId);
  return person ? { name: person.name, roles: person.roles } : undefined;
}

export function hasRole(person: Person, role: Role): boolean {
  return person.roles.includes(role);
}
