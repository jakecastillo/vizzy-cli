import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import { App } from './App.js';
import { delay, waitFor, KEY } from '../test-utils.js';
import type { Repo } from '../types.js';
import type { CliFlags } from '../cli.js';
import type { TreeFetcher } from '../core/scan.js';

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

  // ── scanning stage (public only) ────────────────────────────────────────────

  it('public flow: passes through scanning stage and reaches confirm', async () => {
    // The stub treeFetch returns an empty tree for every repo (no findings).
    const treeFetch: TreeFetcher = vi.fn().mockResolvedValue({ paths: [], truncated: false });
    const setter = vi.fn().mockResolvedValue(undefined);
    const onComplete = vi.fn();
    const loadRepos = vi.fn().mockResolvedValue([repo('priv-a', 'private')]);

    const { stdin, lastFrame, frames, unmount } = render(
      <App
        flags={flags({ public: true })}
        loadRepos={loadRepos}
        setter={setter}
        onComplete={onComplete}
        treeFetch={treeFetch}
        protectPatterns={[]}
      />,
    );

    // Wait for RepoList to appear, then select and submit.
    await waitFor(() => (lastFrame() ?? '').includes('priv-a'));
    await delay(100);
    stdin.write(KEY.space); // select priv-a
    await waitFor(() => (lastFrame() ?? '').includes('1 selected'));
    stdin.write(KEY.enter); // submit selection → triggers scanning stage

    // Scanning spinner should appear while assessRepos is in flight.
    await waitFor(() => seen(frames, 'Checking'));

    // After scanning completes, the confirm screen should appear.
    await waitFor(() => (lastFrame() ?? '').includes('Proceed?'));

    // treeFetch was called for the selected repo.
    expect(treeFetch).toHaveBeenCalled();

    await delay(100);
    stdin.write('y');
    await waitFor(() => onComplete.mock.calls.length > 0);
    expect(setter).toHaveBeenCalledWith('me', 'priv-a', 'public');
    unmount();
  });

  it('public flow with protected repo: shows protected notice and excludes the protected repo', async () => {
    const treeFetch: TreeFetcher = vi.fn().mockResolvedValue({ paths: [], truncated: false });
    const setter = vi.fn().mockResolvedValue(undefined);
    const onComplete = vi.fn();
    // Two private repos; 'secret-repo' is in the .vizzyignore patterns.
    const loadRepos = vi.fn().mockResolvedValue([
      repo('priv-a', 'private'),
      repo('secret-repo', 'private'),
    ]);

    const { stdin, lastFrame, frames, unmount } = render(
      <App
        flags={flags({ public: true })}
        loadRepos={loadRepos}
        setter={setter}
        onComplete={onComplete}
        treeFetch={treeFetch}
        protectPatterns={['secret-repo']}
      />,
    );

    // Select all repos in RepoList.
    await waitFor(() => (lastFrame() ?? '').includes('priv-a'));
    await delay(100);
    stdin.write('a'); // select all
    await waitFor(() => (lastFrame() ?? '').includes('2 selected'));
    stdin.write(KEY.enter);

    // Protected notice should appear during scanning.
    await waitFor(() => seen(frames, 'protected'));

    // After scanning, confirm should appear.
    await waitFor(() => (lastFrame() ?? '').includes('Proceed?'));

    // Only priv-a should have been scanned, not secret-repo.
    const calls = (treeFetch as ReturnType<typeof vi.fn>).mock.calls as [Repo][];
    expect(calls.every((c) => c[0].name !== 'secret-repo')).toBe(true);

    unmount();
  });

  it('public flow: a rejecting treeFetch degrades gracefully and still reaches confirm', async () => {
    // A failing scan must NOT abort the TUI. assessRepos isolates the per-repo
    // rejection (→ scan-incomplete); the app advances to confirm and stays operable.
    const treeFetch: TreeFetcher = vi.fn().mockRejectedValue(new Error('network down'));
    const setter = vi.fn().mockResolvedValue(undefined);
    const onComplete = vi.fn();
    const loadRepos = vi.fn().mockResolvedValue([repo('priv-a', 'private')]);

    const { stdin, lastFrame, unmount } = render(
      <App
        flags={flags({ public: true })}
        loadRepos={loadRepos}
        setter={setter}
        onComplete={onComplete}
        treeFetch={treeFetch}
        protectPatterns={[]}
      />,
    );

    await waitFor(() => (lastFrame() ?? '').includes('priv-a'));
    await delay(100);
    stdin.write(KEY.space); // select priv-a
    await waitFor(() => (lastFrame() ?? '').includes('1 selected'));
    stdin.write(KEY.enter); // submit → scanning

    // (1) does not crash and (2) advances to confirm despite the scan failure.
    await waitFor(() => (lastFrame() ?? '').includes('Proceed?'));
    expect(treeFetch).toHaveBeenCalled();

    // (3) the flow remains operable end-to-end and onComplete eventually fires.
    await delay(100);
    stdin.write('y');
    await waitFor(() => onComplete.mock.calls.length > 0);
    expect(setter).toHaveBeenCalledWith('me', 'priv-a', 'public');
    unmount();
  });

  it('public flow: flags.protect===false skips protected filtering', async () => {
    const treeFetch: TreeFetcher = vi.fn().mockResolvedValue({ paths: [], truncated: false });
    const loadRepos = vi.fn().mockResolvedValue([
      repo('priv-a', 'private'),
      repo('secret-repo', 'private'),
    ]);

    const { stdin, lastFrame, unmount } = render(
      <App
        flags={flags({ public: true, protect: false })}
        loadRepos={loadRepos}
        setter={vi.fn()}
        onComplete={vi.fn()}
        treeFetch={treeFetch}
        protectPatterns={['secret-repo']}
      />,
    );

    await waitFor(() => (lastFrame() ?? '').includes('priv-a'));
    await delay(100);
    stdin.write('a');
    await waitFor(() => (lastFrame() ?? '').includes('2 selected'));
    stdin.write(KEY.enter);

    await waitFor(() => (lastFrame() ?? '').includes('Proceed?'));

    // Both repos must have been scanned (no filtering).
    expect((treeFetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);

    unmount();
  });

  it('private flow: scanning stage is NOT entered even with treeFetch provided', async () => {
    const treeFetch: TreeFetcher = vi.fn().mockResolvedValue({ paths: [], truncated: false });
    const setter = vi.fn().mockResolvedValue(undefined);
    const onComplete = vi.fn();
    const loadRepos = vi.fn().mockResolvedValue([repo('pub-a', 'public')]);

    const { stdin, lastFrame, frames, unmount } = render(
      <App
        flags={flags({ private: true })}
        loadRepos={loadRepos}
        setter={setter}
        onComplete={onComplete}
        treeFetch={treeFetch}
        protectPatterns={[]}
      />,
    );

    await waitFor(() => (lastFrame() ?? '').includes('pub-a'));
    await delay(100);
    stdin.write(KEY.space); // select
    await waitFor(() => (lastFrame() ?? '').includes('1 selected'));
    stdin.write(KEY.enter);

    // Should go straight to confirm (no scanning spinner).
    await waitFor(() => (lastFrame() ?? '').includes('Proceed?'));

    // treeFetch must NOT have been called for a private target.
    expect(treeFetch).not.toHaveBeenCalled();
    expect(seen(frames, 'Checking')).toBe(false);

    unmount();
  });
});
