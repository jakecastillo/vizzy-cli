#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render } from 'ink';
import { parseArgs } from './cli.js';
import { getToken } from './auth.js';
import { makeOctokit, listOwnerRepos, makeSetter, listRepoTree } from './github.js';
import { loadProtected } from './core/protected.js';
import { loadScanRules } from './core/scanrules.js';
import { App } from './ui/App.js';
import { runAudit } from './audit.js';
import { runHeadless } from './headless.js';

const flags = parseArgs();

// --audit: non-interactive mode — run before TTY check and Ink render.
// Exit-code contract: 0 ok/clean · 1 danger or apply-failure · 2 usage error · 3 auth/network error
if (flags.audit) {
  let token: string;
  try {
    token = await getToken();
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(3); // exit 3 = auth/network error
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
      format: flags.format,
    },
  );
  process.exit(code);
}

// ── Headless apply: route non-interactive (--repos / --all-eligible / --yes) to runHeadless
// BEFORE the TTY check so that CI/scripts get a proper exit code and clean output.
const isHeadless = !!(flags.yes || (flags.repos && flags.repos.length > 0) || flags.allEligible);

if (isHeadless) {
  // Resolve target: --public or --private. Default to 'private' when neither given.
  const target = flags.public ? 'public' : 'private';

  let token: string;
  try {
    token = await getToken();
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(3);
  }

  const octokit = makeOctokit(token);

  const code = await runHeadless(
    {
      loadRepos: () => listOwnerRepos(octokit),
      setter: makeSetter(octokit),
      treeFetch: (repo) => listRepoTree(octokit, repo.owner, repo.name, repo.defaultBranch),
    },
    {
      target,
      repos: flags.repos,
      allEligible: flags.allEligible,
      yes: flags.yes,
      allowDanger: flags.allowDanger,
      forcePublic: flags.forcePublic,
      json: flags.format === 'json',
      forks: flags.forks,
      includeArchived: flags.includeArchived,
    },
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

// ── TTY check — interactive TUI requires a terminal ──────────────────────────
if (!process.stdin.isTTY || !process.stdout.isTTY) {
  process.stderr.write(
    [
      'vizzy: no TTY detected and no headless flags were given.',
      '',
      'To run headless (scriptable), use one of:',
      '  vizzy --public --all-eligible --yes',
      '  vizzy --public --repos alpha,beta --yes',
      '  vizzy --public --repos @repos.txt --yes',
      '',
      'To suppress the interactive TUI, also add --json for machine output.',
      'See `vizzy --help` for all options.',
      '',
    ].join('\n'),
  );
  process.exit(2); // exit 2 = usage error (no TTY and no headless flags)
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

// Read .vizzyscan from cwd. Missing file → no-op (empty rules).
// The extra rules are threaded into classifyPath via the treeFetch/assess chain
// through the App props (scanRules).
let scanRulesText = '';
try {
  scanRulesText = readFileSync(join(process.cwd(), '.vizzyscan'), 'utf8');
} catch {
  // File does not exist or is unreadable — treat as empty.
}
const scanRules = loadScanRules(scanRulesText);

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
    scanRules={scanRules}
  />,
);
await waitUntilExit();
