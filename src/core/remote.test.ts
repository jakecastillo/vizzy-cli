import { describe, it, expect } from 'vitest';
import { parseRemote } from './remote.js';

describe('parseRemote', () => {
  it('parses an SSH remote with a trailing .git', () => {
    expect(parseRemote('git@github.com:owner/repo.git')).toBe('owner/repo');
  });

  it('parses an SSH remote without a trailing .git', () => {
    expect(parseRemote('git@github.com:owner/repo')).toBe('owner/repo');
  });

  it('parses an HTTPS remote with a trailing .git', () => {
    expect(parseRemote('https://github.com/owner/repo.git')).toBe('owner/repo');
  });

  it('parses an HTTPS remote without a trailing .git', () => {
    expect(parseRemote('https://github.com/owner/repo')).toBe('owner/repo');
  });

  // Repo names with dots are extremely common (every *.github.io Pages repo,
  // react.dev, my.app). The capture must NOT stop at the first dot.
  it('keeps dots in an SSH repo name and strips only the trailing .git', () => {
    expect(parseRemote('git@github.com:owner/foo.github.io.git')).toBe('owner/foo.github.io');
  });

  it('keeps dots in an HTTPS repo name', () => {
    expect(parseRemote('https://github.com/owner/my.app.git')).toBe('owner/my.app');
  });

  it('handles a dotted repo with no trailing .git', () => {
    expect(parseRemote('git@github.com:owner/react.dev')).toBe('owner/react.dev');
  });

  it('does not strip a non-trailing .git inside the name', () => {
    expect(parseRemote('git@github.com:owner/foo.git.io')).toBe('owner/foo.git.io');
  });

  it('returns null for an unparseable remote', () => {
    expect(parseRemote('not a remote')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseRemote('')).toBeNull();
  });
});
