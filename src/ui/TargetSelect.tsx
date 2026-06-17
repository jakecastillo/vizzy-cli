import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Visibility } from '../types.js';

const OPTIONS: Visibility[] = ['private', 'public'];

export function TargetSelect({
  onSelect,
}: {
  onSelect: (target: Visibility) => void;
}): JSX.Element {
  const [cursor, setCursor] = useState(0);

  useInput((_input, key) => {
    if (key.upArrow) setCursor((c) => (c > 0 ? c - 1 : OPTIONS.length - 1));
    else if (key.downArrow) setCursor((c) => (c < OPTIONS.length - 1 ? c + 1 : 0));
    else if (key.return) onSelect(OPTIONS[cursor]!);
  });

  return (
    <Box flexDirection="column">
      <Text bold>Set selected repos to:</Text>
      {OPTIONS.map((opt, i) => (
        <Text key={opt} color={i === cursor ? 'cyan' : undefined}>
          {i === cursor ? '❯ ' : '  '}
          {opt === 'public' ? 'Public' : 'Private'}
        </Text>
      ))}
      <Box marginTop={1}>
        <Text dimColor>↑↓ move · enter select</Text>
      </Box>
    </Box>
  );
}
