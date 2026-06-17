import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class TokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenError';
  }
}

export interface TokenDeps {
  /** Returns the raw stdout of `gh auth token`, or throws if unavailable. */
  runGh?: () => Promise<string>;
  env?: NodeJS.ProcessEnv;
}

async function defaultRunGh(): Promise<string> {
  const { stdout } = await execFileAsync('gh', ['auth', 'token'], {
    maxBuffer: 1024 * 1024,
  });
  return stdout;
}

/**
 * Resolve a GitHub token. Order: `gh auth token` -> GH_TOKEN -> GITHUB_TOKEN
 * -> throw. A single gh call already covers gh-stored creds AND env tokens;
 * the explicit env fallback matters mainly when the gh binary is missing.
 */
export async function getToken(deps: TokenDeps = {}): Promise<string> {
  const runGh = deps.runGh ?? defaultRunGh;
  const env = deps.env ?? process.env;

  try {
    const token = (await runGh()).trim();
    if (token) return token;
  } catch {
    // gh missing or logged out — fall through to env vars.
  }

  const envToken = env.GH_TOKEN?.trim() || env.GITHUB_TOKEN?.trim();
  if (envToken) return envToken;

  throw new TokenError(
    'No GitHub token found.\n' +
      'Run `gh auth login` (recommended), or set GITHUB_TOKEN / GH_TOKEN.\n' +
      'The token needs the classic `repo` scope, or a fine-grained PAT with\n' +
      'repository Administration: Read and write to change repo visibility.',
  );
}
