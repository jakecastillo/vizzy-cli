import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Bundled into dist/bin.js at runtime, where package.json sits one level up; in
// tests this file is src/version.ts, also one level under the package root — so
// '../package.json' resolves correctly in both contexts. Single source of truth
// for the version so SARIF output / banners never drift from package.json.
const pkg = require('../package.json') as { version: string };

export const VERSION = pkg.version;
