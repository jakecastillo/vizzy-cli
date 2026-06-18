#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { render } from 'ink';
import { parseArgs } from './cli.js';
import { getToken } from './auth.js';
import { makeOctokit, listOwnerRepos, makeSetter, listRepoTree, getBlobText, listHistoryFilenames, normalizeRepo } from './github.js';
import { loadProtected } from './core/protected.js';
import { loadScanRules } from './core/scanrules.js';
import { App } from './ui/App.js';
import { runAudit } from './audit.js';
import { runHeadless } from './headless.js';
import { runCheck } from './check.js';

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

// ── vizzy check: pre-publish readiness for one repo ─────────────────────────
if (flags.check !== undefined && flags.check !== false) {
  // Resolve the repo ref: explicit "owner/repo" arg or infer from cwd git remote.
  let repoRef: string;
  if (typeof flags.check === 'string') {
    repoRef = flags.check;
  } else {
    // Infer from git remote get-url origin
    try {
      const remote = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
      // Parse SSH (git@github.com:owner/repo.git) or HTTPS (https://github.com/owner/repo.git)
      const sshMatch = remote.match(/git@[^:]+:([^/]+\/[^.]+)(\.git)?$/);
      const httpsMatch = remote.match(/https?:\/\/[^/]+\/([^/]+\/[^/.]+)(\.git)?$/);
      const matched = sshMatch ?? httpsMatch;
      if (!matched || !matched[1]) {
        process.stderr.write(
          `vizzy check: could not parse owner/repo from git remote "${remote}".\n` +
            'Pass an explicit "owner/repo" argument: vizzy --check owner/repo\n',
        );
        process.exit(3);
      }
      repoRef = matched[1];
    } catch {
      process.stderr.write(
        'vizzy check: could not read git remote origin from cwd.\n' +
          'Run from a git repository or pass an explicit "owner/repo" argument.\n',
      );
      process.exit(3);
    }
  }

  let token: string;
  try {
    token = await getToken();
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(3);
  }

  const octokit = makeOctokit(token);

  // Read .vizzyscan from cwd
  let scanRulesText = '';
  try {
    scanRulesText = readFileSync(join(process.cwd(), '.vizzyscan'), 'utf8');
  } catch {
    // Missing — treat as empty
  }

  const code = await runCheck(repoRef, {
    loadRepo: async (o, n) => {
      const { data } = await octokit.rest.repos.get({ owner: o, repo: n });
      return normalizeRepo(data as Parameters<typeof normalizeRepo>[0]);
    },
    treeFetch: async (repo) => {
      // Fetch tree with blob sizes directly — runCheck needs { items, truncated }.
      const { data } = await octokit.rest.git.getTree({
        owner: repo.owner,
        repo: repo.name,
        tree_sha: repo.defaultBranch,
        recursive: '1',
      });
      const items = data.tree
        .filter((item) => item.type === 'blob')
        .map((item) => ({ path: item.path ?? '', size: item.size }));
      return { items, truncated: data.truncated ?? false };
    },
    contentFetcher: async (repo, path) => {
      // Need the blob SHA — look it up from the tree
      const { data } = await octokit.rest.git.getTree({
        owner: repo.owner,
        repo: repo.name,
        tree_sha: repo.defaultBranch,
        recursive: '1',
      });
      const blob = data.tree.find((i) => i.path === path && i.type === 'blob');
      if (!blob?.sha) throw new Error(`Blob SHA not found for ${path}`);
      return getBlobText(octokit, repo.owner, repo.name, blob.sha);
    },
    historyFetcher: async (repo) => listHistoryFilenames(octokit, repo.owner, repo.name),
    scanRulesText,
  }, {
    assessOpts: {
      staleMonths: 12,
      highProfileStars: 10,
      now: new Date(),
    },
  });

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
