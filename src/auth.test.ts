import { describe, it, expect } from 'vitest';
import { getToken, TokenError } from './auth.js';

describe('getToken', () => {
  it('returns the trimmed gh token when gh succeeds', async () => {
    const token = await getToken({
      runGh: async () => 'ghtoken123\n',
      env: {},
    });
    expect(token).toBe('ghtoken123');
  });

  it('falls back to GH_TOKEN when gh fails', async () => {
    const token = await getToken({
      runGh: async () => {
        throw new Error('gh not installed');
      },
      env: { GH_TOKEN: 'envtok' },
    });
    expect(token).toBe('envtok');
  });

  it('falls back to GITHUB_TOKEN when gh fails and GH_TOKEN is absent', async () => {
    const token = await getToken({
      runGh: async () => {
        throw new Error('logged out');
      },
      env: { GITHUB_TOKEN: 'ghub' },
    });
    expect(token).toBe('ghub');
  });

  it('prefers GH_TOKEN over GITHUB_TOKEN', async () => {
    const token = await getToken({
      runGh: async () => {
        throw new Error('x');
      },
      env: { GH_TOKEN: 'a', GITHUB_TOKEN: 'b' },
    });
    expect(token).toBe('a');
  });

  it('throws TokenError when nothing is available', async () => {
    await expect(
      getToken({
        runGh: async () => {
          throw new Error('x');
        },
        env: {},
      }),
    ).rejects.toBeInstanceOf(TokenError);
  });
});
