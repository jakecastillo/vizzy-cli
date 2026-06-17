import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { Visibility, RowStatus } from '../types.js';

export interface ProgressRow {
  name: string;
  status: RowStatus;
  error?: string;
}

function Marker({ status }: { status: RowStatus }): JSX.Element {
  if (status === 'applying')
    return (
      <Text color="yellow">
        <Spinner type="dots" />
      </Text>
    );
  if (status === 'done') return <Text color="green">✔</Text>;
  if (status === 'error') return <Text color="red">✖</Text>;
  return <Text dimColor>·</Text>;
}

export function ApplyProgress({
  rows,
  target,
}: {
  rows: ProgressRow[];
  target: Visibility;
}): JSX.Element {
  return (
    <Box flexDirection="column">
      {rows.map((row) => (
        <Box key={row.name}>
          <Box width={3}>
            <Marker status={row.status} />
          </Box>
          <Text>{row.name}</Text>
          <Text dimColor>{`  → ${target}`}</Text>
          {row.error ? <Text color="red">{`  ${row.error}`}</Text> : null}
        </Box>
      ))}
    </Box>
  );
}
