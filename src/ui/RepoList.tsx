import { useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Repo, Visibility } from '../types.js';

export function RepoList({
  repos,
  target,
  onSubmit,
  limit = 12,
}: {
  repos: Repo[];
  target: Visibility;
  onSubmit: (selected: Repo[]) => void;
  limit?: number;
}): JSX.Element {
  const [cursor, setCursor] = useState(0);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [offset, setOffset] = useState(0);

  // Read the latest selection from a ref in the input handler: Ink re-subscribes
  // useInput on each render, but a keypress arriving before the new closure is
  // installed would otherwise read a stale `checked`.
  const checkedRef = useRef(checked);
  checkedRef.current = checked;

  const reframe = (next: number) => {
    if (next < offset) setOffset(next);
    else if (next > offset + limit - 1) setOffset(next - limit + 1);
  };

  useInput((input, key) => {
    if (key.upArrow) {
      const next = cursor > 0 ? cursor - 1 : repos.length - 1;
      setCursor(next);
      reframe(next);
    } else if (key.downArrow) {
      const next = cursor < repos.length - 1 ? cursor + 1 : 0;
      setCursor(next);
      reframe(next);
    } else if (input === ' ') {
      setChecked((prev) => {
        const next = new Set(prev);
        if (next.has(cursor)) next.delete(cursor);
        else next.add(cursor);
        return next;
      });
    } else if (input === 'a') {
      setChecked((prev) =>
        prev.size === repos.length ? new Set() : new Set(repos.map((_, i) => i)),
      );
    } else if (key.return) {
      onSubmit(repos.filter((_, i) => checkedRef.current.has(i)));
    }
  });

  const nameWidth = Math.max(4, ...repos.map((r) => r.name.length));
  const visible = repos.slice(offset, offset + limit);

  return (
    <Box flexDirection="column">
      <Text bold>{`Choose repos to make ${target.toUpperCase()}:`}</Text>
      {visible.map((repo, i) => {
        const index = offset + i;
        const isCursor = index === cursor;
        const isChecked = checked.has(index);
        return (
          <Box key={repo.name}>
            <Text color={isCursor ? 'cyan' : undefined}>{isCursor ? '❯ ' : '  '}</Text>
            <Text color={isChecked ? 'green' : undefined}>{isChecked ? '◉ ' : '◯ '}</Text>
            <Text color={isCursor ? 'cyan' : undefined}>{repo.name.padEnd(nameWidth)}</Text>
            <Text dimColor>{`   ${repo.visibility}   ★ ${repo.stars}`}</Text>
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text dimColor>{`↑↓ move · space toggle · a all · enter confirm (${checked.size} selected)`}</Text>
      </Box>
    </Box>
  );
}
