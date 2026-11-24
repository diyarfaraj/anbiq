/** A file a pull request changes, as the git host reports it. */
export interface ChangedFile {
  path: string;
  /** Where the file was before, when it was renamed. */
  previousPath?: string;
  /** Lines added plus lines removed. */
  changedLines: number;
}

export interface FastLane {
  /** Glob patterns for files that are low-risk to change, such as documentation. */
  paths: readonly string[];
  max_changed_lines: number;
}

export type FastLaneVerdict =
  { ok: true; files: number; changedLines: number } | { ok: false; reason: string };

/**
 * Decides from what a change actually touches whether it may skip QA. The request's wording
 * plays no part, so a request cannot talk its way into the fast lane.
 */
export function fastLaneVerdict(files: readonly ChangedFile[], lane: FastLane): FastLaneVerdict {
  if (files.length === 0) {
    return { ok: false, reason: 'the change is empty' };
  }
  for (const file of files) {
    // A rename counts under both names: moving code into a documentation folder removes code.
    for (const path of file.previousPath ? [file.path, file.previousPath] : [file.path]) {
      if (!lane.paths.some((pattern) => matchesGlob(path, pattern))) {
        return { ok: false, reason: `it touches ${path}` };
      }
    }
  }
  const changedLines = files.reduce((sum, file) => sum + file.changedLines, 0);
  if (changedLines > lane.max_changed_lines) {
    return {
      ok: false,
      reason: `it changes ${changedLines} lines, over the limit of ${lane.max_changed_lines}`,
    };
  }
  return { ok: true, files: files.length, changedLines };
}

// Matches a repository path against a glob. "*" and "?" stay within one path segment, "**"
// crosses segments, and the whole path must match: "*.md" is a top-level file only, while a
// pattern that starts with "**" and a slash matches at any depth.
export function matchesGlob(path: string, pattern: string): boolean {
  let source = '';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!;
    if (char === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') {
        source += '(?:.*/)?';
        i += 2;
      } else {
        source += '.*';
        i += 1;
      }
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`).test(path);
}
