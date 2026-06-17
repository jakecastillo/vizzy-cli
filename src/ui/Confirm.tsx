import { Box, Text, useInput } from 'ink';
import { formatSummary, type ChangePlan } from '../core/plan.js';
import type { RepoAssessment } from '../core/checks.js';

export function Confirm({
  plan,
  dryRun,
  assessments: _assessments,
  onConfirm,
}: {
  plan: ChangePlan;
  dryRun?: boolean;
  /** Assessments from the scanning stage (bead .8 will consume these). */
  assessments?: RepoAssessment[];
  onConfirm: (yes: boolean) => void;
}): JSX.Element {
  useInput((input) => {
    onConfirm(input.toLowerCase() === 'y');
  });

  const loud = plan.target === 'public';
  return (
    <Box flexDirection="column">
      <Text color={loud ? 'red' : undefined}>{formatSummary(plan)}</Text>
      <Box marginTop={1}>
        <Text>
          {dryRun ? '[dry-run] ' : ''}
          Proceed? (y/N)
        </Text>
      </Box>
    </Box>
  );
}
