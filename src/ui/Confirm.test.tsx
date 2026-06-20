import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { Confirm } from './Confirm.js';
import { buildPlan } from '../core/plan.js';
import { delay, KEY } from '../test-utils.js';
import type { Repo } from '../types.js';
import type { RepoAssessment } from '../core/checks.js';

const repo = (name: string, v: Repo['visibility'], overrides: Partial<Repo> = {}): Repo => ({
  name,
  owner: 'me',
  visibility: v,
  isFork: false,
  isArchived: false,
  stars: 0,
  forksCount: 0,
  pushedAt: '2024-01-01T00:00:00Z',
  defaultBranch: 'main',
  license: null,
  ...overrides,
});

/** Build a RepoAssessment for a clean repo (empty paths, future pushedAt, has license). */
const cleanRepo = (name: string, overrides: Partial<Repo> = {}): Repo => ({
  name,
  owner: 'me',
  visibility: 'private',
  isFork: false,
  isArchived: false,
  stars: 0,
  forksCount: 0,
  pushedAt: new Date().toISOString(), // not stale
  defaultBranch: 'main',
  license: 'MIT', // has license → not no-license
  ...overrides,
});

const cleanAssessment = (r: Repo): RepoAssessment => ({
  repo: r,
  findings: [],
  severity: 'clean',
  requiredConfirm: 'y',
});

const cautionAssessment = (r: Repo): RepoAssessment => ({
  repo: r,
  findings: [{ kind: 'stale', severity: 'caution', label: 'Stale' }],
  severity: 'caution',
  requiredConfirm: 'phrase',
});

const dangerAssessment = (r: Repo): RepoAssessment => ({
  repo: r,
  findings: [{ kind: 'secret-file', severity: 'danger', label: '.env tracked', detail: '.env' }],
  severity: 'danger',
  requiredConfirm: 'name',
});

describe('Confirm — private target (unchanged)', () => {
  it('shows the summary and a dry-run notice', () => {
    const plan = buildPlan('private', [repo('a', 'public')]);
    const { lastFrame, unmount } = render(
      <Confirm plan={plan} dryRun onConfirm={() => {}} />,
    );
    expect(lastFrame()).toContain('PRIVATE');
    expect(lastFrame()!.toLowerCase()).toContain('dry');
    unmount();
  });

  it('confirms on y — returns plan.repos to apply', async () => {
    const onConfirm = vi.fn();
    const r = repo('a', 'public');
    const plan = buildPlan('private', [r]);
    const { stdin, unmount } = render(<Confirm plan={plan} onConfirm={onConfirm} />);
    await delay();
    stdin.write('y');
    await delay();
    expect(onConfirm).toHaveBeenCalledWith([r]);
    unmount();
  });

  it('declines on n — returns empty array (cancel)', async () => {
    const onConfirm = vi.fn();
    const plan = buildPlan('private', [repo('a', 'public')]);
    const { stdin, unmount } = render(<Confirm plan={plan} onConfirm={onConfirm} />);
    await delay();
    stdin.write('n');
    await delay();
    expect(onConfirm).toHaveBeenCalledWith([]);
    unmount();
  });

  it('ignores navigation keys — an arrow key does NOT cancel the session', async () => {
    const onConfirm = vi.fn();
    const plan = buildPlan('private', [repo('a', 'public')]);
    const { stdin, unmount } = render(<Confirm plan={plan} onConfirm={onConfirm} />);
    await delay();
    // Ink delivers arrow keys as input='' — these must be ignored, not treated
    // as a cancel. Only an explicit y/n acts.
    stdin.write(KEY.up);
    stdin.write(KEY.down);
    stdin.write(KEY.left);
    await delay();
    expect(onConfirm).not.toHaveBeenCalled();
    unmount();
  });
});

describe('Confirm — public target, clean batch (y/N)', () => {
  it('shows per-repo list with clean glyph', () => {
    const r = cleanRepo('my-repo');
    const plan = buildPlan('public', [r]);
    const assessments = [cleanAssessment(r)];
    const { lastFrame, unmount } = render(
      <Confirm plan={plan} assessments={assessments} onConfirm={() => {}} />,
    );
    expect(lastFrame()).toContain('my-repo');
    expect(lastFrame()).toContain('✓');
    unmount();
  });

  it('proceeds on y (clean batch)', async () => {
    const r = cleanRepo('my-repo');
    const plan = buildPlan('public', [r]);
    const assessments = [cleanAssessment(r)];
    const onConfirm = vi.fn();
    const { stdin, unmount } = render(
      <Confirm plan={plan} assessments={assessments} onConfirm={onConfirm} />,
    );
    await delay();
    stdin.write('y');
    await delay();
    expect(onConfirm).toHaveBeenCalledWith([r]);
    unmount();
  });

  it('cancels on n (clean batch)', async () => {
    const r = cleanRepo('my-repo');
    const plan = buildPlan('public', [r]);
    const assessments = [cleanAssessment(r)];
    const onConfirm = vi.fn();
    const { stdin, unmount } = render(
      <Confirm plan={plan} assessments={assessments} onConfirm={onConfirm} />,
    );
    await delay();
    stdin.write('n');
    await delay();
    expect(onConfirm).toHaveBeenCalledWith([]);
    unmount();
  });
});

describe('Confirm — public target, caution batch (must type "public")', () => {
  it('shows per-repo list with caution glyph and findings', () => {
    const r = repo('stale-repo', 'private');
    const plan = buildPlan('public', [r]);
    const assessments = [cautionAssessment(r)];
    const { lastFrame, unmount } = render(
      <Confirm plan={plan} assessments={assessments} onConfirm={() => {}} />,
    );
    expect(lastFrame()).toContain('stale-repo');
    expect(lastFrame()).toContain('⚠');
    expect(lastFrame()).toContain('Stale');
    unmount();
  });

  it('shows prompt requiring "public" token', () => {
    const r = repo('stale-repo', 'private');
    const plan = buildPlan('public', [r]);
    const assessments = [cautionAssessment(r)];
    const { lastFrame, unmount } = render(
      <Confirm plan={plan} assessments={assessments} onConfirm={() => {}} />,
    );
    expect(lastFrame()!.toLowerCase()).toContain('public');
    unmount();
  });

  it('proceeds when "public" is typed + Enter', async () => {
    const r = repo('stale-repo', 'private');
    const plan = buildPlan('public', [r]);
    const assessments = [cautionAssessment(r)];
    const onConfirm = vi.fn();
    const { stdin, unmount } = render(
      <Confirm plan={plan} assessments={assessments} onConfirm={onConfirm} />,
    );
    await delay();
    // Type 'public' then Enter
    for (const ch of 'public') stdin.write(ch);
    await delay();
    stdin.write(KEY.enter);
    await delay();
    expect(onConfirm).toHaveBeenCalledWith([r]);
    unmount();
  });

  it('NEGATIVE: bare "y" does NOT proceed on caution batch', async () => {
    const r = repo('stale-repo', 'private');
    const plan = buildPlan('public', [r]);
    const assessments = [cautionAssessment(r)];
    const onConfirm = vi.fn();
    const { stdin, unmount } = render(
      <Confirm plan={plan} assessments={assessments} onConfirm={onConfirm} />,
    );
    await delay();
    stdin.write('y');
    await delay();
    stdin.write(KEY.enter);
    await delay();
    expect(onConfirm).not.toHaveBeenCalled();
    unmount();
  });

  it('NEGATIVE: wrong token does NOT proceed on caution batch', async () => {
    const r = repo('stale-repo', 'private');
    const plan = buildPlan('public', [r]);
    const assessments = [cautionAssessment(r)];
    const onConfirm = vi.fn();
    const { stdin, unmount } = render(
      <Confirm plan={plan} assessments={assessments} onConfirm={onConfirm} />,
    );
    await delay();
    for (const ch of 'wrong') stdin.write(ch);
    await delay();
    stdin.write(KEY.enter);
    await delay();
    expect(onConfirm).not.toHaveBeenCalled();
    unmount();
  });

  it('case-insensitive: "PUBLIC" proceeds on caution batch', async () => {
    const r = repo('stale-repo', 'private');
    const plan = buildPlan('public', [r]);
    const assessments = [cautionAssessment(r)];
    const onConfirm = vi.fn();
    const { stdin, unmount } = render(
      <Confirm plan={plan} assessments={assessments} onConfirm={onConfirm} />,
    );
    await delay();
    for (const ch of 'PUBLIC') stdin.write(ch);
    await delay();
    stdin.write(KEY.enter);
    await delay();
    expect(onConfirm).toHaveBeenCalledWith([r]);
    unmount();
  });

  it('Backspace corrects a mistyped token (caution batch)', async () => {
    const r = repo('stale-repo', 'private');
    const plan = buildPlan('public', [r]);
    const assessments = [cautionAssessment(r)];
    const onConfirm = vi.fn();
    const { stdin, unmount } = render(
      <Confirm plan={plan} assessments={assessments} onConfirm={onConfirm} />,
    );
    await delay();
    // Mistype "publix", Backspace the stray 'x', then finish with 'c' → "public".
    for (const ch of 'publix') stdin.write(ch);
    await delay();
    stdin.write(KEY.backspace);
    await delay();
    stdin.write('c');
    await delay();
    stdin.write(KEY.enter);
    await delay();
    expect(onConfirm).toHaveBeenCalledWith([r]);
    unmount();
  });
});

describe('Confirm — public target, danger batch (arm-by-name)', () => {
  it('shows per-repo list with danger glyph', () => {
    const r = repo('secret-repo', 'private');
    const plan = buildPlan('public', [r]);
    const assessments = [dangerAssessment(r)];
    const { lastFrame, unmount } = render(
      <Confirm plan={plan} assessments={assessments} onConfirm={() => {}} />,
    );
    expect(lastFrame()).toContain('secret-repo');
    expect(lastFrame()).toContain('✗');
    unmount();
  });

  it('arms a danger repo by typing its exact name + Enter', async () => {
    const r = repo('secret-repo', 'private');
    const plan = buildPlan('public', [r]);
    const assessments = [dangerAssessment(r)];
    const onConfirm = vi.fn();
    const { stdin, unmount } = render(
      <Confirm plan={plan} assessments={assessments} onConfirm={onConfirm} />,
    );
    await delay();
    for (const ch of 'secret-repo') stdin.write(ch);
    await delay();
    stdin.write(KEY.enter);
    await delay();
    expect(onConfirm).toHaveBeenCalledWith([r]);
    unmount();
  });

  it('Backspace lets the user correct a mistyped danger repo name before arming', async () => {
    const r = repo('secret-repo', 'private');
    const plan = buildPlan('public', [r]);
    const assessments = [dangerAssessment(r)];
    const onConfirm = vi.fn();
    const { stdin, unmount } = render(
      <Confirm plan={plan} assessments={assessments} onConfirm={onConfirm} />,
    );
    await delay();
    // Mistype the name "secret-repX", Backspace the 'X', finish with 'o' → arms "secret-repo".
    for (const ch of 'secret-repX') stdin.write(ch);
    await delay();
    stdin.write(KEY.backspace);
    await delay();
    stdin.write('o');
    await delay();
    stdin.write(KEY.enter);
    await delay();
    expect(onConfirm).toHaveBeenCalledWith([r]);
    unmount();
  });

  it('unarmed danger repo is excluded (skipped) and armed repos are applied', async () => {
    const danger = repo('secret-repo', 'private');
    const caution = repo('stale-repo', 'private');
    const plan = buildPlan('public', [danger, caution]);
    const assessments = [dangerAssessment(danger), cautionAssessment(caution)];
    const onConfirm = vi.fn();
    const { stdin, unmount } = render(
      <Confirm plan={plan} assessments={assessments} onConfirm={onConfirm} />,
    );
    await delay();

    // Leave the danger repo unarmed and skip it via the documented path: Enter
    // on an empty buffer ("...or Enter to skip remaining"). The caution repo is
    // applied; the unarmed danger repo is excluded.
    stdin.write(KEY.enter);
    await delay();

    expect(onConfirm).toHaveBeenCalledWith([caution]);
    const applied = (onConfirm as ReturnType<typeof vi.fn>).mock.calls[0][0] as Repo[];
    expect(applied.map((r) => r.name)).not.toContain('secret-repo');
    expect(applied.map((r) => r.name)).toContain('stale-repo');
    unmount();
  });

  it('a typo of a danger repo name + Enter does NOT apply the batch — it re-prompts', async () => {
    const danger = repo('secret-repo', 'private');
    const caution = repo('stale-repo', 'private');
    const plan = buildPlan('public', [danger, caution]);
    const assessments = [dangerAssessment(danger), cautionAssessment(caution)];
    const onConfirm = vi.fn();
    const { stdin, lastFrame, unmount } = render(
      <Confirm plan={plan} assessments={assessments} onConfirm={onConfirm} />,
    );
    await delay();
    // The user MEANT to arm "secret-repo" but fat-fingered the name. A near-miss
    // is exactly what the arm-by-name gate exists to catch — it must NOT silently
    // commit the rest of the batch to public.
    for (const ch of 'secret-repX') stdin.write(ch);
    await delay();
    stdin.write(KEY.enter);
    await delay();
    expect(onConfirm).not.toHaveBeenCalled();
    // Still in the arming phase, ready for another attempt.
    expect(lastFrame()).toContain('arm');
    unmount();
  });

  it('after a near-miss the buffer resets so the user can still arm correctly', async () => {
    const danger = repo('secret-repo', 'private');
    const plan = buildPlan('public', [danger]);
    const assessments = [dangerAssessment(danger)];
    const onConfirm = vi.fn();
    const { stdin, unmount } = render(
      <Confirm plan={plan} assessments={assessments} onConfirm={onConfirm} />,
    );
    await delay();
    // Typo first (cleared, no-op), then type the exact name → arms + finalizes.
    for (const ch of 'secret-repX') stdin.write(ch);
    await delay();
    stdin.write(KEY.enter);
    await delay();
    expect(onConfirm).not.toHaveBeenCalled();
    for (const ch of 'secret-repo') stdin.write(ch);
    await delay();
    stdin.write(KEY.enter);
    await delay();
    expect(onConfirm).toHaveBeenCalledWith([danger]);
    unmount();
  });

  it('renders the "skipped — likely secret" label for an unarmed danger repo and excludes it on submit', async () => {
    const danger = repo('secret-repo', 'private');
    const plan = buildPlan('public', [danger]);
    const assessments = [dangerAssessment(danger)];
    const onConfirm = vi.fn();
    const { stdin, lastFrame, unmount } = render(
      <Confirm plan={plan} assessments={assessments} onConfirm={onConfirm} />,
    );
    await delay();
    // The unarmed danger repo is visibly marked as skipped (the named scenario).
    expect(lastFrame()).toContain('skipped');
    // Submitting without arming excludes it → empty apply (cancel).
    stdin.write(KEY.enter);
    await delay();
    expect(onConfirm).toHaveBeenCalledWith([]);
    unmount();
  });
});

describe('Confirm — --force-public flag', () => {
  it('with force-public: danger repos are pre-armed; confirm by typing "public"', async () => {
    const r = repo('secret-repo', 'private');
    const plan = buildPlan('public', [r]);
    const assessments = [dangerAssessment(r)];
    const onConfirm = vi.fn();
    const { stdin, unmount } = render(
      <Confirm plan={plan} assessments={assessments} forcePublic onConfirm={onConfirm} />,
    );
    await delay();
    for (const ch of 'public') stdin.write(ch);
    await delay();
    stdin.write(KEY.enter);
    await delay();
    expect(onConfirm).toHaveBeenCalledWith([r]);
    unmount();
  });

  it('with force-public: "y" alone still does NOT proceed (must type "public")', async () => {
    const r = repo('secret-repo', 'private');
    const plan = buildPlan('public', [r]);
    const assessments = [dangerAssessment(r)];
    const onConfirm = vi.fn();
    const { stdin, unmount } = render(
      <Confirm plan={plan} assessments={assessments} forcePublic onConfirm={onConfirm} />,
    );
    await delay();
    stdin.write('y');
    await delay();
    stdin.write(KEY.enter);
    await delay();
    expect(onConfirm).not.toHaveBeenCalled();
    unmount();
  });
});

describe('Confirm — consequences rendering', () => {
  it('private confirm: shows erases-stars consequence when stars > 0', () => {
    const r = repo('starred-repo', 'public', { stars: 7 });
    const plan = buildPlan('private', [r]);
    const { lastFrame, unmount } = render(<Confirm plan={plan} onConfirm={() => {}} />);
    expect(lastFrame()).toContain('erases 7 stars');
    unmount();
  });

  it('private confirm: omits erases-stars when stars === 0', () => {
    const r = repo('no-stars-repo', 'public', { stars: 0 });
    const plan = buildPlan('private', [r]);
    const { lastFrame, unmount } = render(<Confirm plan={plan} onConfirm={() => {}} />);
    expect(lastFrame()).not.toMatch(/erases.*star/);
    unmount();
  });

  it('private confirm: shows detaches-forks consequence when forksCount > 0', () => {
    const r = repo('forked-repo', 'public', { forksCount: 4 });
    const plan = buildPlan('private', [r]);
    const { lastFrame, unmount } = render(<Confirm plan={plan} onConfirm={() => {}} />);
    expect(lastFrame()).toContain('detaches 4 forks');
    unmount();
  });

  it('private confirm: shows unpublishes GitHub Pages', () => {
    const r = repo('my-repo', 'public');
    const plan = buildPlan('private', [r]);
    const { lastFrame, unmount } = render(<Confirm plan={plan} onConfirm={() => {}} />);
    expect(lastFrame()).toContain('unpublishes GitHub Pages');
    unmount();
  });

  it('public confirm: shows publishes Actions logs', () => {
    const r = cleanRepo('my-repo');
    const plan = buildPlan('public', [r]);
    const assessments = [cleanAssessment(r)];
    const { lastFrame, unmount } = render(
      <Confirm plan={plan} assessments={assessments} onConfirm={() => {}} />,
    );
    expect(lastFrame()).toContain('publishes Actions logs');
    unmount();
  });

  it('public confirm: shows disables push rulesets', () => {
    const r = cleanRepo('my-repo');
    const plan = buildPlan('public', [r]);
    const assessments = [cleanAssessment(r)];
    const { lastFrame, unmount } = render(
      <Confirm plan={plan} assessments={assessments} onConfirm={() => {}} />,
    );
    expect(lastFrame()).toContain('disables push rulesets');
    unmount();
  });
});
