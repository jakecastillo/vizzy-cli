import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import { App } from './App.js';
import { delay, KEY } from '../test-utils.js';
import type { Repo } from '../types.js';
import type { CliFlags } from '../cli.js';

// Defensive: App never mutates process.exitCode (it uses the onComplete prop),
// but reset anyway so no test can leak a non-zero code into the vitest runner.
afterEach(() => {
  process.exitCode = 0;
});

const repo = (name: string, v: Repo['visibility']): Repo => ({
  name,
  owner: 'me',
  visibility: v,
  isFork: false,
  isArchived: false,
  stars: 0,
  pushedAt: '2024-01-01T00:00:00Z',
});

const flags = (over: Partial<CliFlags> = {}): CliFlags => ({ forks: true, ...over });

describe('App', () => {
  it('runs the full private flow and applies the selection', async () => {
    const setter = vi.fn().mockResolvedValue(undefined);
    const onComplete = vi.fn();
    const loadRepos = vi.fn().mockResolvedValue([repo('pub-a', 'public'), repo('already', 'private')]);
    const { stdin, lastFrame, unmount } = render(
      <App flags={flags({ private: true })} loadRepos={loadRepos} setter={setter} onComplete={onComplete} />,
    );
    await delay(40); // skip target (flag set) + finish loading
    expect(lastFrame()).toContain('pub-a');
    expect(lastFrame()).not.toContain('already'); // filtered: already private
    stdin.write(KEY.space); // select pub-a
    await delay();
    stdin.write(KEY.enter); // submit
    await delay();
    expect(lastFrame()).toContain('Proceed?');
    stdin.write('y');
    await delay(60); // apply path crosses an extra effect+promise boundary
    expect(setter).toHaveBeenCalledWith('me', 'pub-a', 'private');
    expect(lastFrame()!.toLowerCase()).toContain('done');
    expect(onComplete).toHaveBeenCalledWith(0);
    unmount();
  });

  it('reports apply failures via onComplete(1) without crashing the run', async () => {
    const onComplete = vi.fn();
    const setter = vi.fn().mockRejectedValue(new Error('denied'));
    const loadRepos = vi.fn().mockResolvedValue([repo('pub-a', 'public')]);
    const { stdin, lastFrame, unmount } = render(
      <App flags={flags({ private: true })} loadRepos={loadRepos} setter={setter} onComplete={onComplete} />,
    );
    await delay(40);
    stdin.write('a'); // select all
    await delay();
    stdin.write(KEY.enter);
    await delay();
    stdin.write('y');
    await delay(60);
    expect(onComplete).toHaveBeenCalledWith(1);
    expect(lastFrame()).toContain('1 failed');
    unmount();
  });

  it('renders a load error and reports it via onComplete(1)', async () => {
    const onComplete = vi.fn();
    const loadRepos = vi.fn().mockRejectedValue(new Error('boom: bad token'));
    const { lastFrame, unmount } = render(
      <App flags={flags({ private: true })} loadRepos={loadRepos} setter={vi.fn()} onComplete={onComplete} />,
    );
    await delay(40);
    expect(lastFrame()).toContain('boom: bad token');
    expect(onComplete).toHaveBeenCalledWith(1);
    unmount();
  });

  it('shows a friendly message when nothing is eligible', async () => {
    const onComplete = vi.fn();
    const loadRepos = vi.fn().mockResolvedValue([repo('already', 'private')]);
    const { lastFrame, unmount } = render(
      <App flags={flags({ private: true })} loadRepos={loadRepos} setter={vi.fn()} onComplete={onComplete} />,
    );
    await delay(40);
    expect(lastFrame()!.toLowerCase()).toContain('nothing');
    expect(onComplete).toHaveBeenCalledWith(0);
    unmount();
  });

  it('dry-run does not call the setter', async () => {
    const setter = vi.fn().mockResolvedValue(undefined);
    const loadRepos = vi.fn().mockResolvedValue([repo('pub-a', 'public')]);
    const { stdin, lastFrame, unmount } = render(
      <App flags={flags({ private: true, dryRun: true })} loadRepos={loadRepos} setter={setter} />,
    );
    await delay(40);
    stdin.write('a'); // select all
    await delay();
    stdin.write(KEY.enter);
    await delay();
    stdin.write('y');
    await delay(60);
    expect(setter).not.toHaveBeenCalled();
    expect(lastFrame()!.toLowerCase()).toContain('dry');
    unmount();
  });
});
