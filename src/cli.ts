import { Command, Option } from 'commander';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// At runtime this file is dist/bin.js's bundle; package.json sits one level up.
const pkg = require('../package.json') as { version: string };

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
    .option('--json', 'output JSON report (alias for --format json)');

  if (opts.exitOverride) program.exitOverride();

  if (userArgv) program.parse(userArgv, { from: 'user' });
  else program.parse(process.argv);

  const parsed = program.opts<CliFlags & { json?: boolean }>();

  // --json is a convenience alias for --format json
  if (parsed.json && !parsed.format) {
    parsed.format = 'json';
  }

  return parsed;
}
