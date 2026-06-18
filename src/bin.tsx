#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { render } from 'ink';
import { parseArgs } from './cli.js';
import { getToken } from './auth.js';
import { makeOctokit, listOwnerRepos, listOrgRepos, makeSetter, listRepoTree, getBlobText, listHistoryFilenames, normalizeRepo } from './github.js';
import { loadProtected } from './core/protected.js';
import { loadScanRules } from './core/scanrules.js';
import { App } from './ui/App.js';
import { runAudit } from './audit.js';
import { runHeadless } from './headless.js';
import { runCheck } from './check.js';
import { runArchive } from './archive.js';
import { setArchived } from './github.js';

const flags = parseArgs();

// --audit: non-interactive mode — run before TTY check and Ink render.
// Exit-code contract: 0 ok/clean · 1 danger or apply-failure · 2 usage error · 3 auth/network error
if (flags.audit) {
  // --org combined with write flags is a usage error (exit 2).
  // Commander's .conflicts() handles --org + --public/--private at parse time,
  // but guard defensively here as well for belt-and-suspenders.
  if (flags.org && (flags.public || flags.private)) {
    process.stderr.write(
      'vizzy: --org cannot be combined with write flags (--public / --private).\n' +
        'The --org flag is read-only (audit only).\n',
    );
    process.exit(2);
  }

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

  // Use listOrgRepos when --org is given; otherwise fall back to personal repos.
  const repoLoader = flags.org
    ? () => listOrgRepos(octokit, flags.org!)
    : () => listOwnerRepos(octokit);

  const code = await runAudit(
    repoLoader,
    treeFetch,
    {
      assessOpts: {
        staleMonths: 12,
        highProfileStars: 10,
        now: new Date(),
      },
      format: flags.format,
      // Drift: read/write .vizzy/state.json so --fail-on-new compares against it.
      failOnNew: flags.failOnNew,
      snapshotPath: join(process.cwd(), '.vizzy', 'state.json'),
      readSnapshot: (p) => {
        try {
          return JSON.parse(readFileSync(p, 'utf8'));
        } catch {
          return null; // first run / unreadable → no baseline
        }
      },
      writeSnapshot: (p, state) => {
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, JSON.stringify(state, null, 2) + '\n');
      },
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

// ── Archive / Unarchive: route --archive / --unarchive to runArchive (headless, no exposure scan).
// Routed BEFORE the TTY check and the visibility-headless block.
if (flags.archive || flags.unarchive) {
  let token: string;
  try {
    token = await getToken();
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(3);
  }

  const octokit = makeOctokit(token);

  const code = await runArchive(
    {
      loadRepos: () => listOwnerRepos(octokit),
      setArchived: (owner, name, archived) => setArchived(octokit, owner, name, archived),
    },
    {
      archive: flags.archive,
      unarchive: flags.unarchive,
      repos: flags.repos,
      allEligible: flags.allEligible,
      yes: flags.yes,
      json: flags.format === 'json',
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
