import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { TargetSelect } from './TargetSelect.js';
import { delay, KEY } from '../test-utils.js';

describe('TargetSelect', () => {
  it('renders both options with the cursor on Private', () => {
    const { lastFrame, unmount } = render(<TargetSelect onSelect={() => {}} />);
    expect(lastFrame()).toContain('Private');
    expect(lastFrame()).toContain('Public');
    unmount();
  });

  it('selects Private by default on Enter', async () => {
    const onSelect = vi.fn();
    const { stdin, unmount } = render(<TargetSelect onSelect={onSelect} />);
    await delay();
    stdin.write(KEY.enter);
    await delay();
    expect(onSelect).toHaveBeenCalledWith('private');
    unmount();
  });

  it('moves to Public and selects it', async () => {
    const onSelect = vi.fn();
    const { stdin, unmount } = render(<TargetSelect onSelect={onSelect} />);
    await delay();
    stdin.write(KEY.down);
    await delay();
    stdin.write(KEY.enter);
    await delay();
    expect(onSelect).toHaveBeenCalledWith('public');
    unmount();
  });
});
