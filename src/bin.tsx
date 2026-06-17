#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render } from 'ink';
import { parseArgs } from './cli.js';
import { getToken } from './auth.js';
import { makeOctokit, listOwnerRepos, makeSetter, listRepoTree } from './github.js';
import { loadProtected } from './core/protected.js';
import { App } from './ui/App.js';
import { runAudit } from './audit.js';

const flags = parseArgs();

// --audit: non-interactive mode — run before TTY check and Ink render.
if (flags.audit) {
  let token: string;
  try {
    token = await getToken();
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  const octokit = makeOctokit(token);
  const treeFetch = (repo: { owner: string; name: string; defaultBranch: string }) =>
    listRepoTree(octokit, repo.owner, repo.name, repo.defaultBranch);

  const code = await runAudit(
    () => listOwnerRepos(octokit),
    treeFetch,
    {
      assessOpts: {
        staleMonths: 12,
        highProfileStars: 10,
        now: new Date(),
      },
    },
  );
  process.exit(code);
}

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  process.stderr.write('vizzy is interactive and must be run in a terminal (TTY).\n');
  process.exit(1);
}

let token: string;
try {
  token = await getToken();
} catch (err) {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}

// Read .vizzyignore from cwd. Missing file → no-op (empty patterns).
let protectPatterns: string[] = [];
try {
  const text = readFileSync(join(process.cwd(), '.vizzyignore'), 'utf8');
  protectPatterns = loadProtected(text);
} catch {
  // File does not exist or is unreadable — treat as empty.
}

const octokit = makeOctokit(token);
const { waitUntilExit } = render(
  <App
    flags={flags}
    loadRepos={() => listOwnerRepos(octokit)}
    setter={makeSetter(octokit)}
    onComplete={(failed) => {
      if (failed > 0) process.exitCode = 1;
    }}
    treeFetch={(repo) => listRepoTree(octokit, repo.owner, repo.name, repo.defaultBranch)}
    protectPatterns={protectPatterns}
  />,
);
await waitUntilExit();
