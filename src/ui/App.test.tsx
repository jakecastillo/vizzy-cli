import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import { App } from './App.js';
import { delay, waitFor, KEY } from '../test-utils.js';
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
  defaultBranch: 'main',
  license: null,
});

const flags = (over: Partial<CliFlags> = {}): CliFlags => ({ forks: true, protect: true, ...over });

// Search the full frame history (not just lastFrame): Ink clears the frame on
// unmount, so a completed flow's content lives in `frames`, not the last frame.
const seen = (frames: string[], text: string): boolean =>
  frames.some((f) => f.toLowerCase().includes(text.toLowerCase()));

describe('App', () => {
  it('runs the full private flow and applies the selection', async () => {
    const setter = vi.fn().mockResolvedValue(undefined);
    const onComplete = vi.fn();
    const loadRepos = vi.fn().mockResolvedValue([repo('pub-a', 'public'), repo('already', 'private')]);
    const { stdin, lastFrame, frames, unmount } = render(
      <App flags={flags({ private: true })} loadRepos={loadRepos} setter={setter} onComplete={onComplete} />,
    );

    await waitFor(() => (lastFrame() ?? '').includes('pub-a')); // loaded + on select screen
    expect(lastFrame()).not.toContain('already'); // filtered: already private
    await delay(100); // settle so RepoList's useInput subscribes before the first key

    stdin.write(KEY.space); // select pub-a
    await waitFor(() => (lastFrame() ?? '').includes('1 selected'));
    stdin.write(KEY.enter); // submit
    await waitFor(() => (lastFrame() ?? '').includes('Proceed?'));
    await delay(100); // settle so Confirm's useInput subscribes before the keypress
    stdin.write('y');

    await waitFor(() => onComplete.mock.calls.length > 0); // terminal state reached
    expect(setter).toHaveBeenCalledWith('me', 'pub-a', 'private');
    expect(onComplete).toHaveBeenCalledWith(0);
    expect(seen(frames, 'done')).toBe(true);
    unmount();
  });

  it('reports apply failures via onComplete(1) without crashing the run', async () => {
    const onComplete = vi.fn();
    const setter = vi.fn().mockRejectedValue(new Error('denied'));
    const loadRepos = vi.fn().mockResolvedValue([repo('pub-a', 'public')]);
    const { stdin, lastFrame, frames, unmount } = render(
      <App flags={flags({ private: true })} loadRepos={loadRepos} setter={setter} onComplete={onComplete} />,
    );

    await waitFor(() => (lastFrame() ?? '').includes('pub-a'));
    await delay(100); // settle so RepoList's useInput subscribes before the first key
    stdin.write('a'); // select all
    await waitFor(() => (lastFrame() ?? '').includes('1 selected'));
    stdin.write(KEY.enter);
    await waitFor(() => (lastFrame() ?? '').includes('Proceed?'));
    await delay(100); // settle so Confirm's useInput subscribes before the keypress
    stdin.write('y');

    await waitFor(() => onComplete.mock.calls.length > 0);
    expect(onComplete).toHaveBeenCalledWith(1);
    expect(seen(frames, '1 failed')).toBe(true);
    unmount();
  });

  it('renders a load error and reports it via onComplete(1)', async () => {
    const onComplete = vi.fn();
    const loadRepos = vi.fn().mockRejectedValue(new Error('boom: bad token'));
    const { frames, unmount } = render(
      <App flags={flags({ private: true })} loadRepos={loadRepos} setter={vi.fn()} onComplete={onComplete} />,
    );

    await waitFor(() => onComplete.mock.calls.length > 0);
    expect(onComplete).toHaveBeenCalledWith(1);
    expect(seen(frames, 'boom: bad token')).toBe(true);
    unmount();
  });

  it('shows a friendly message when nothing is eligible', async () => {
    const onComplete = vi.fn();
    const loadRepos = vi.fn().mockResolvedValue([repo('already', 'private')]);
    const { frames, unmount } = render(
      <App flags={flags({ private: true })} loadRepos={loadRepos} setter={vi.fn()} onComplete={onComplete} />,
    );

    await waitFor(() => onComplete.mock.calls.length > 0);
    expect(onComplete).toHaveBeenCalledWith(0);
    expect(seen(frames, 'nothing')).toBe(true);
    unmount();
  });

  it('dry-run does not call the setter', async () => {
    const setter = vi.fn().mockResolvedValue(undefined);
    const onComplete = vi.fn();
    const loadRepos = vi.fn().mockResolvedValue([repo('pub-a', 'public')]);
    const { stdin, lastFrame, frames, unmount } = render(
      <App flags={flags({ private: true, dryRun: true })} loadRepos={loadRepos} setter={setter} onComplete={onComplete} />,
    );

    await waitFor(() => (lastFrame() ?? '').includes('pub-a'));
    await delay(100); // settle so RepoList's useInput subscribes before the first key
    stdin.write('a'); // select all
    await waitFor(() => (lastFrame() ?? '').includes('1 selected'));
    stdin.write(KEY.enter);
    await waitFor(() => (lastFrame() ?? '').includes('Proceed?'));
    await delay(100); // settle so Confirm's useInput subscribes before the keypress
    stdin.write('y');

    await waitFor(() => onComplete.mock.calls.length > 0);
    expect(setter).not.toHaveBeenCalled();
    expect(seen(frames, 'dry')).toBe(true);
    unmount();
  });
});
