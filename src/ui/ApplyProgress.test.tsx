import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { ApplyProgress } from './ApplyProgress.js';

describe('ApplyProgress', () => {
  it('renders a marker and name per row', () => {
    const { lastFrame, unmount } = render(
      <ApplyProgress
        target="private"
        rows={[
          { name: 'done-one', status: 'done' },
          { name: 'failed-one', status: 'error', error: 'denied' },
          { name: 'waiting-one', status: 'pending' },
        ]}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('done-one');
    expect(frame).toContain('failed-one');
    expect(frame).toContain('denied');
    expect(frame).toContain('waiting-one');
    unmount();
  });
});
