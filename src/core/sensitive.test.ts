import { describe, it, expect } from 'vitest';
import { classifyPath, scanPaths } from './sensitive.js';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/** Assert that a path produces a hit whose rule name contains the label. */
function expectHit(path: string, ruleFragment: string) {
  const hit = classifyPath(path);
  expect(hit, `expected hit for "${path}"`).not.toBeNull();
  expect(hit!.rule, `rule for "${path}"`).toContain(ruleFragment);
  expect(hit!.path).toBe(path);
}

/** Assert that a path is NOT flagged. */
function expectClean(path: string) {
  const hit = classifyPath(path);
  expect(hit, `expected no hit for "${path}" but got rule="${hit?.rule}"`).toBeNull();
}

// ---------------------------------------------------------------------------
// .env rules
// ---------------------------------------------------------------------------

describe('classifyPath — .env', () => {
  it('flags bare .env', () => expectHit('.env', 'env'));
  it('flags .env.production', () => expectHit('.env.production', 'env'));
  it('flags .env.local', () => expectHit('.env.local', 'env'));
  it('flags .env.staging', () => expectHit('.env.staging', 'env'));
  it('flags nested .env', () => expectHit('config/.env', 'env'));

  // --- exclusions ---
  it('spares .env.example', () => expectClean('.env.example'));
  it('spares .env.sample', () => expectClean('.env.sample'));
  it('spares .env.template', () => expectClean('.env.template'));
  it('spares .env.dist', () => expectClean('.env.dist'));
  it('spares .env.defaults', () => expectClean('.env.defaults'));
  it('spares nested .env.example', () => expectClean('project/.env.example'));
});

// ---------------------------------------------------------------------------
// Private key rules
// ---------------------------------------------------------------------------

describe('classifyPath — private keys', () => {
  it('flags id_rsa', () => expectHit('id_rsa', 'key'));
  it('flags id_dsa', () => expectHit('id_dsa', 'key'));
  it('flags id_ecdsa', () => expectHit('id_ecdsa', 'key'));
  it('flags id_ed25519', () => expectHit('id_ed25519', 'key'));
  it('flags nested id_rsa', () => expectHit('.ssh/id_rsa', 'key'));

  it('flags *.pem', () => expectHit('server.pem', 'key'));
  it('flags nested *.pem', () => expectHit('certs/server.pem', 'key'));

  it('flags *.key', () => expectHit('secret.key', 'key'));
  it('flags nested *.key', () => expectHit('keys/api.key', 'key'));

  it('flags *.ppk', () => expectHit('mykey.ppk', 'key'));
  it('flags *.p12', () => expectHit('cert.p12', 'key'));
  it('flags *.pfx', () => expectHit('cert.pfx', 'key'));
  it('flags *.keystore', () => expectHit('app.keystore', 'key'));
  it('flags *.jks', () => expectHit('app.jks', 'key'));

  // --- exclusions ---
  it('spares id_rsa.pub (public key)', () => expectClean('id_rsa.pub'));
  it('spares id_ed25519.pub', () => expectClean('id_ed25519.pub'));
  it('spares *.pub.key', () => expectClean('my.pub.key'));
  it('spares *.public.key', () => expectClean('my.public.key'));
});

// ---------------------------------------------------------------------------
// Credentials rules
// ---------------------------------------------------------------------------

describe('classifyPath — credentials', () => {
  it('flags credentials (bare)', () => expectHit('credentials', 'cred'));
  it('flags credentials.json', () => expectHit('credentials.json', 'cred'));
  it('flags .npmrc', () => expectHit('.npmrc', 'cred'));
  it('flags nested .npmrc', () => expectHit('home/.npmrc', 'cred'));
  it('flags .pypirc', () => expectHit('.pypirc', 'cred'));

  it('flags service-account.json', () => expectHit('service-account.json', 'cred'));
  it('flags service-account-prod.json', () => expectHit('service-account-prod.json', 'cred'));
  it('flags my-service-account.json', () => expectHit('my-service-account.json', 'cred'));
  it('flags gcloud-creds.json', () => expectHit('gcloud-creds.json', 'cred'));
  it('flags .aws/credentials (path)', () => expectHit('.aws/credentials', 'cred'));
  it('flags *.kdbx', () => expectHit('passwords.kdbx', 'cred'));

  it('flags secrets.json', () => expectHit('secrets.json', 'cred'));
  it('flags secrets.env', () => expectHit('secrets.env', 'cred'));
  it('flags secrets (bare)', () => expectHit('secrets', 'cred'));
  // Regression (jd9/uov): "example" without a following dot is NOT a sample file.
  it('flags secrets.example2.json', () => expectHit('secrets.example2.json', 'cred'));
  it('flags secrets.examplefile.json', () => expectHit('secrets.examplefile.json', 'cred'));

  // --- exclusions ---
  it('spares secrets.example.json', () => expectClean('secrets.example.json'));
  it('spares secrets.example.env', () => expectClean('secrets.example.env'));
  it('spares secrets.example (bare)', () => expectClean('secrets.example'));
});

// ---------------------------------------------------------------------------
// Directory exclusions (node_modules, .git, vendor, dist, build)
// ---------------------------------------------------------------------------

describe('classifyPath — directory exclusions', () => {
  it('spares node_modules/.env', () => expectClean('node_modules/.env'));
  it('spares node_modules/deep/id_rsa', () => expectClean('node_modules/deep/id_rsa'));
  it('spares .git/credentials', () => expectClean('.git/credentials'));
  it('spares vendor/secrets.json', () => expectClean('vendor/secrets.json'));
  it('spares dist/.env', () => expectClean('dist/.env'));
  it('spares build/secrets.env', () => expectClean('build/secrets.env'));
});

// ---------------------------------------------------------------------------
// *.lock exclusion
// ---------------------------------------------------------------------------

describe('classifyPath — *.lock exclusion', () => {
  it('spares package-lock.json (not flaggable anyway, but proves *.lock rule)', () =>
    expectClean('package-lock.json'));
  // A contrived lock file that would otherwise match nothing — just verify the
  // rule doesn't interfere; pick a name with "key" to exercise it.
  it('spares something.lock even if it contains key-like name', () =>
    expectClean('secrets.lock'));
});

// ---------------------------------------------------------------------------
// Case-insensitivity
// ---------------------------------------------------------------------------

describe('classifyPath — case insensitivity', () => {
  it('flags .ENV', () => expect(classifyPath('.ENV')).not.toBeNull());
  it('flags ID_RSA', () => expect(classifyPath('ID_RSA')).not.toBeNull());
  it('flags Server.PEM', () => expect(classifyPath('Server.PEM')).not.toBeNull());
  it('flags .NPMRC', () => expect(classifyPath('.NPMRC')).not.toBeNull());
  it('spares .ENV.EXAMPLE', () => expectClean('.ENV.EXAMPLE'));
});

// ---------------------------------------------------------------------------
// scanPaths (bulk helper)
// ---------------------------------------------------------------------------

describe('scanPaths', () => {
  it('returns empty array when no paths match', () => {
    expect(scanPaths(['.env.example', 'node_modules/.env', 'README.md'])).toEqual([]);
  });

  it('returns a hit per matching path', () => {
    const hits = scanPaths(['.env', 'id_rsa', 'README.md', '.env.example']);
    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.path)).toContain('.env');
    expect(hits.map((h) => h.path)).toContain('id_rsa');
  });

  it('preserves the original path in each hit', () => {
    const hits = scanPaths(['src/config/credentials.json']);
    expect(hits[0]!.path).toBe('src/config/credentials.json');
  });
});
