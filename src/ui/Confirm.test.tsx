import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { Confirm } from './Confirm.js';
import { buildPlan } from '../core/plan.js';
import { delay } from '../test-utils.js';
import type { Repo } from '../types.js';

const repo = (name: string, v: Repo['visibility']): Repo => ({
  name,
  owner: 'me',
  visibility: v,
  isFork: false,
  isArchived: false,
  stars: 0,
  pushedAt: '2024-01-01T00:00:00Z',
});

describe('Confirm', () => {
  it('shows the summary and a dry-run notice', () => {
    const plan = buildPlan('private', [repo('a', 'public')]);
    const { lastFrame, unmount } = render(
      <Confirm plan={plan} dryRun onConfirm={() => {}} />,
    );
    expect(lastFrame()).toContain('PRIVATE');
    expect(lastFrame()!.toLowerCase()).toContain('dry');
    unmount();
  });

  it('confirms on y', async () => {
    const onConfirm = vi.fn();
    const plan = buildPlan('public', [repo('s', 'private')]);
    const { stdin, unmount } = render(<Confirm plan={plan} onConfirm={onConfirm} />);
    await delay();
    stdin.write('y');
    await delay();
    expect(onConfirm).toHaveBeenCalledWith(true);
    unmount();
  });

  it('declines on n', async () => {
    const onConfirm = vi.fn();
    const plan = buildPlan('private', [repo('a', 'public')]);
    const { stdin, unmount } = render(<Confirm plan={plan} onConfirm={onConfirm} />);
    await delay();
    stdin.write('n');
    await delay();
    expect(onConfirm).toHaveBeenCalledWith(false);
    unmount();
  });
});
