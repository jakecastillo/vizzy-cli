import { readFileSync } from 'node:fs';
import { Command, Option } from 'commander';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// At runtime this file is dist/bin.js's bundle; package.json sits one level up.
const pkg = require('../package.json') as { version: string };

// ---------------------------------------------------------------------------
// --repos list resolver (csv / @file / - for stdin)
// ---------------------------------------------------------------------------

/**
 * Expand a --repos value into a string[].
 *   - "@path"  → read the file, one name per line (trim, skip blank/comments)
 *   - "-"      → read process.stdin synchronously (Node's readFileSync on /dev/stdin)
 *   - "a,b,c"  → split on commas
 */
function expandReposList(raw: string): string[] {
  if (raw.startsWith('@')) {
    const path = raw.slice(1);
    const text = readFileSync(path, 'utf8');
    return parseReposLines(text);
  }
  if (raw === '-') {
    const text = readFileSync('/dev/stdin', 'utf8');
    return parseReposLines(text);
  }
  // CSV
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseReposLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
}

export interface CliFlags {
  public?: boolean;
  private?: boolean;
  dryRun?: boolean;
  includeArchived?: boolean;
  forks: boolean;
  forcePublic?: boolean;
  protect: boolean;
  audit?: boolean;
  /** Output format for --audit. 'text' = human-readable (default), 'json' = JSON report, 'sarif' = SARIF 2.1.0. */
  format?: 'text' | 'json' | 'sarif';
  /** Explicit repo names (csv / @file / stdin — read in the CLI layer, stored as string[]). */
  repos?: string[];
  /** Select all eligible repos without interactive multi-select. */
  allEligible?: boolean;
  /** Apply caution-level repos without interactive confirmation. */
  yes?: boolean;
  /** Allow applying even danger repos (bypass safety guard). */
  allowDanger?: boolean;
  /**
   * Pre-publish readiness check for one repo.
   * Value is "owner/repo" (explicit) or true (infer from cwd git remote).
   */
  check?: string | boolean;
  /**
   * GitHub org to audit. When set, --audit uses listOrgRepos instead of
   * listOwnerRepos. READ-ONLY audit path only — write flags are rejected.
   */
  org?: string;
}

export function parseArgs(
  userArgv?: string[],
  opts: { exitOverride?: boolean } = {},
): CliFlags {
  const program = new Command();

  // Exit-code contract (for --help and bin.tsx):
  //   0  clean / ok — no danger findings, or apply completed with no failures
  //   1  danger finding detected, or apply had one or more failures
  //   2  usage error — bad flags, unknown option, conflicting options
  //   3  auth / network error — token missing or GitHub API unreachable
  program
    .name('vizzy')
    .description(
      [
        'Bulk-change the visibility of your personal GitHub repos.',
        '',
        'Exit codes:',
        '  0  ok / clean — no danger findings, apply succeeded',
        '  1  danger finding detected, or apply had failures',
        '  2  usage error (bad flags)',
        '  3  auth / network error',
      ].join('\n'),
    )
    .version(pkg.version, '-v, --version', 'output the current version')
    .addOption(new Option('--public', 'target visibility: public').conflicts('private'))
    .addOption(new Option('--private', 'target visibility: private').conflicts('public'))
    .addOption(new Option('--dry-run', 'preview changes without applying them').conflicts('audit'))
    .option('--include-archived', 'include archived repositories')
    .option('--no-forks', 'exclude forked repositories')
    .option('--force-public', 'skip per-repo name confirmation for danger repos when going public')
    .option('--no-protect', 'ignore .vizzyignore protected-repos list')
    .addOption(new Option('--audit', 'non-interactive audit: report public repo exposure risk and exit').conflicts('dryRun'))
    .addOption(
      new Option('--format <format>', 'output format for --audit: text (default), json, or sarif')
        .choices(['text', 'json', 'sarif']),
    )
    .option('--json', 'output JSON report (alias for --format json)')
    .option(
      '--repos <list>',
      'comma-separated repo names, @file path, or - for stdin (headless mode)',
    )
    .option('--all-eligible', 'select all eligible repos (headless mode)')
    .option('--yes', 'apply caution-level repos without confirmation (headless mode)')
    .option('--allow-danger', 'apply even danger repos without confirmation (headless mode)')
    .option(
      '--check [repo]',
      'pre-publish readiness check for one repo (owner/repo, or infer from cwd git remote)',
    )
    .addOption(
      new Option('--org <name>', 'audit a GitHub org (read-only; cannot be combined with write flags)')
        .conflicts(['public', 'private']),
    );

  if (opts.exitOverride) program.exitOverride();

  if (userArgv) program.parse(userArgv, { from: 'user' });
  else program.parse(process.argv);

  const parsed = program.opts<CliFlags & { json?: boolean; repos?: string | string[] }>();

  // --json is a convenience alias for --format json
  if (parsed.json && !parsed.format) {
    parsed.format = 'json';
  }

  // --repos: commander stores the raw string; expand csv/@file/stdin into string[].
  if (typeof parsed.repos === 'string') {
    parsed.repos = expandReposList(parsed.repos as string);
  }

  return parsed as CliFlags;
}
