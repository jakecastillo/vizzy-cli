/**
 * Note on ANSI color observability:
 * vitest runs with chalk.level=0, so ANSI color escape codes are never emitted
 * by Ink regardless of what color props are set. This means we CANNOT test
 * "color disabled → no ANSI codes" here; the codes are always absent.
 *
 * Instead we test the behavioural consequence that IS observable:
 *   - When color is disabled (colorEnabled=false), the spinner component is replaced
 *     with static text ("applying…") so that the output is stable and pipeable.
 *   - When color is enabled, the spinner glyph IS present in frames.
 *
 * The spinner glyph is observable because ink-spinner writes unicode characters
 * (⠋⠙⠹…) not ANSI color codes, and those ARE emitted by the testing renderer.
 */

import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { ColorContext } from './theme.js';
import { ApplyProgress } from './ApplyProgress.js';

const SPINNER_CHARS = new Set(['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']);

function hasSpinnerGlyph(frame: string): boolean {
  return [...frame].some((ch) => SPINNER_CHARS.has(ch));
}

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

  it('with color enabled: "applying" status row shows a spinner glyph', () => {
    // ColorContext defaults to true (color enabled), so the spinner is rendered.
    const { frames, unmount } = render(
      <ColorContext.Provider value={true}>
        <ApplyProgress
          target="private"
          rows={[{ name: 'applying-one', status: 'applying' }]}
        />
      </ColorContext.Provider>,
    );
    // The spinner cycles through glyphs across frames; at least one frame must contain one.
    const anySpinner = frames.some((f) => hasSpinnerGlyph(f));
    expect(anySpinner).toBe(true);
    unmount();
  });

  it('with color disabled: "applying" status row shows static "applying…" text, NOT a spinner glyph', () => {
    const { frames, lastFrame, unmount } = render(
      <ColorContext.Provider value={false}>
        <ApplyProgress
          target="private"
          rows={[{ name: 'applying-one', status: 'applying' }]}
        />
      </ColorContext.Provider>,
    );
    // No spinner glyph in any frame.
    const anySpinner = frames.some((f) => hasSpinnerGlyph(f));
    expect(anySpinner).toBe(false);
    // Static text IS present.
    expect(lastFrame()).toContain('applying…');
    unmount();
  });
});
