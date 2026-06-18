import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { Visibility, RowStatus } from '../types.js';
import { useColor } from './theme.js';

export interface ProgressRow {
  name: string;
  status: RowStatus;
  error?: string;
}

function ColorMarker({ status }: { status: RowStatus }): JSX.Element {
  const color = useColor();
  if (status === 'applying')
    return (
      <Text color={color('yellow')}>
        <Spinner type="dots" />
      </Text>
    );
  if (status === 'done') return <Text color={color('green')}>✔</Text>;
  if (status === 'error') return <Text color={color('red')}>✖</Text>;
  return <Text dimColor>·</Text>;
}

function PlainMarker({ status }: { status: RowStatus }): string {
  if (status === 'applying') return 'applying…';
  if (status === 'done') return '✔';
  if (status === 'error') return '✖';
  return '·';
}

export function ApplyProgress({
  rows,
  target,
}: {
  rows: ProgressRow[];
  target: Visibility;
}): JSX.Element {
  const color = useColor();
  // Detect whether color is enabled by probing the helper.
  // color('sentinel') returns 'sentinel' when enabled, undefined when disabled.
  const colorOn = color('sentinel') !== undefined;

  if (!colorOn) {
    // Plain mode: render rows without Spinner (static text, no animated glyph,
    // no ANSI sequences). The marker label is inlined so layout is not constrained.
    return (
      <Box flexDirection="column">
        {rows.map((row) => (
          <Box key={row.name}>
            <Text>{PlainMarker({ status: row.status })} {row.name}  → {target}</Text>
            {row.error ? <Text>{`  ${row.error}`}</Text> : null}
          </Box>
        ))}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {rows.map((row) => (
        <Box key={row.name}>
          <Box width={3}>
            <ColorMarker status={row.status} />
          </Box>
          <Text>{row.name}</Text>
          <Text dimColor>{`  → ${target}`}</Text>
          {row.error ? <Text color={color('red')}>{`  ${row.error}`}</Text> : null}
        </Box>
      ))}
    </Box>
  );
}
