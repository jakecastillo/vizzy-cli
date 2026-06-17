#!/usr/bin/env node
import { render } from 'ink';
import { parseArgs } from './cli.js';
import { getToken } from './auth.js';
import { makeOctokit, listOwnerRepos, makeSetter } from './github.js';
import { App } from './ui/App.js';

const flags = parseArgs();

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

const octokit = makeOctokit(token);
const { waitUntilExit } = render(
  <App
    flags={flags}
    loadRepos={() => listOwnerRepos(octokit)}
    setter={makeSetter(octokit)}
    onComplete={(failed) => {
      if (failed > 0) process.exitCode = 1;
    }}
  />,
);
await waitUntilExit();
