import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { RepoList } from './RepoList.js';
import { delay, KEY } from '../test-utils.js';
import type { Repo } from '../types.js';

const repo = (name: string): Repo => ({
  name,
  owner: 'me',
  visibility: 'public',
  isFork: false,
  isArchived: false,
  stars: 1,
  pushedAt: '2024-01-01T00:00:00Z',
});

const repos = [repo('alpha'), repo('beta'), repo('gamma')];

describe('RepoList', () => {
  it('renders all repos with empty checkboxes', () => {
    const { lastFrame, unmount } = render(
      <RepoList repos={repos} target="private" onSubmit={() => {}} />,
    );
    expect(lastFrame()).toContain('alpha');
    expect(lastFrame()).toContain('beta');
    expect(lastFrame()).toContain('gamma');
    unmount();
  });

  it('selects with space and submits with enter', async () => {
    const onSubmit = vi.fn();
    const { stdin, unmount } = render(
      <RepoList repos={repos} target="private" onSubmit={onSubmit} />,
    );
    await delay();
    stdin.write(KEY.space); // select alpha
    await delay();
    stdin.write(KEY.down);
    await delay();
    stdin.write(KEY.down);
    await delay();
    stdin.write(KEY.space); // select gamma
    await delay();
    stdin.write(KEY.enter);
    await delay();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].map((r: Repo) => r.name)).toEqual(['alpha', 'gamma']);
    unmount();
  });

  it("selects all with 'a' then submits everything", async () => {
    const onSubmit = vi.fn();
    const { stdin, unmount } = render(
      <RepoList repos={repos} target="private" onSubmit={onSubmit} />,
    );
    await delay();
    stdin.write('a');
    await delay();
    stdin.write(KEY.enter);
    await delay();
    expect(onSubmit.mock.calls[0][0]).toHaveLength(3);
    unmount();
  });
});
