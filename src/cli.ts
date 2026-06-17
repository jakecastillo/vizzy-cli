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
}

export function parseArgs(
  userArgv?: string[],
  opts: { exitOverride?: boolean } = {},
): CliFlags {
  const program = new Command();

  program
    .name('vizzy')
    .description('Bulk-change the visibility of your personal GitHub repos')
    .version(pkg.version, '-v, --version', 'output the current version')
    .addOption(new Option('--public', 'target visibility: public').conflicts('private'))
    .addOption(new Option('--private', 'target visibility: private').conflicts('public'))
    .option('--dry-run', 'preview changes without applying them')
    .option('--include-archived', 'include archived repositories')
    .option('--no-forks', 'exclude forked repositories');

  if (opts.exitOverride) program.exitOverride();

  if (userArgv) program.parse(userArgv, { from: 'user' });
  else program.parse(process.argv);

  return program.opts<CliFlags>();
}
