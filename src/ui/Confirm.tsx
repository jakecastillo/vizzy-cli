import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { formatSummary, type ChangePlan } from '../core/plan.js';
import { consequencesFor } from '../core/consequences.js';
import type { RepoAssessment, Severity } from '../core/checks.js';
import type { Repo, Target } from '../types.js';
import { useColor } from './theme.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function severityGlyph(severity: Severity): string {
  if (severity === 'danger') return '✗';
  if (severity === 'caution') return '⚠';
  return '✓';
}

function severityColor(severity: Severity): string | undefined {
  if (severity === 'danger') return 'red';
  if (severity === 'caution') return 'yellow';
  return 'green';
}

/** Derive the batch-level max severity from a list of assessments. */
function batchSeverity(assessments: RepoAssessment[]): Severity {
  if (assessments.some((a) => a.severity === 'danger')) return 'danger';
  if (assessments.some((a) => a.severity === 'caution')) return 'caution';
  return 'clean';
}

/**
 * Render the aggregated consequences for all repos in the plan.
 * Consequences are deduplicated — e.g. "publishes Actions run logs" appears
 * once even when many repos are going public. Star/fork counts are summed.
 */
function ConsequencesList({ repos, target }: { repos: Repo[]; target: Target }): JSX.Element | null {
  const color = useColor();
  if (repos.length === 0) return null;

  if (target === 'public') {
    // Public consequences are repo-agnostic; use the first repo as a representative.
    const lines = consequencesFor(repos[0], target);
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color={color('yellow')}>Consequences:</Text>
        {lines.map((line) => (
          <Text key={line} color={color('yellow')}>  • {line}</Text>
        ))}
      </Box>
    );
  }

  // Private target: aggregate stars + forks across all repos, then build one list.
  const totalStars = repos.reduce((sum, r) => sum + r.stars, 0);
  const totalForks = repos.reduce((sum, r) => sum + r.forksCount, 0);

  // Build consequences using a synthetic aggregate repo so consequencesFor
  // applies the same conditional logic.
  const aggregateRepo: Repo = { ...repos[0], stars: totalStars, forksCount: totalForks };
  const lines = consequencesFor(aggregateRepo, target);

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={color('yellow')}>Consequences:</Text>
      {lines.map((line) => (
        <Text key={line} color={color('yellow')}>  • {line}</Text>
      ))}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Private target confirm (unchanged behaviour, new onConfirm signature)
// ---------------------------------------------------------------------------

function PrivateConfirm({
  plan,
  dryRun,
  onConfirm,
}: {
  plan: ChangePlan;
  dryRun?: boolean;
  onConfirm: (repos: Repo[]) => void;
}): JSX.Element {
  useInput((input) => {
    // Private target: y/N single keypress. Only 'y' (proceed → plan.repos) and
    // 'n' (cancel → []) act. Everything else — including navigation keys, which
    // Ink delivers as input='' — is ignored, so a stray arrow/escape can't
    // accidentally cancel the whole session.
    if (input.toLowerCase() === 'y') {
      onConfirm(plan.repos);
    } else if (input.toLowerCase() === 'n') {
      onConfirm([]);
    }
  });

  return (
    <Box flexDirection="column">
      <Text>{formatSummary(plan)}</Text>
      <ConsequencesList repos={plan.repos} target={plan.target} />
      <Box marginTop={1}>
        <Text>
          {dryRun ? '[dry-run] ' : ''}
          Proceed? (y/N)
        </Text>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Public target confirm — per-repo review + escalating typed input
// ---------------------------------------------------------------------------

/**
 * Per-repo review row.
 */
function RepoRow({ assessment, armed }: { assessment: RepoAssessment; armed: boolean }): JSX.Element {
  const color = useColor();
  const isUnarmedDanger = assessment.severity === 'danger' && !armed;
  return (
    <Box flexDirection="row">
      <Text color={color(severityColor(assessment.severity))}>
        {severityGlyph(assessment.severity)}
      </Text>
      <Text> {assessment.repo.name}</Text>
      {assessment.findings.length > 0 && (
        <Text color={color('gray')}> — {assessment.findings.map((f) => f.label).join(', ')}</Text>
      )}
      {isUnarmedDanger && (
        <Text color={color('gray')}> [skipped — likely secret]</Text>
      )}
      {assessment.severity === 'danger' && armed && (
        <Text color={color('green')}> [armed]</Text>
      )}
    </Box>
  );
}

/**
 * Clean batch: single keystroke y/N (no Enter needed).
 */
function CleanConfirm({
  plan,
  dryRun,
  assessments,
  onConfirm,
}: {
  plan: ChangePlan;
  dryRun?: boolean;
  assessments: RepoAssessment[];
  onConfirm: (repos: Repo[]) => void;
}): JSX.Element {
  const color = useColor();
  useInput((input) => {
    if (input.toLowerCase() === 'y') {
      onConfirm(plan.repos);
    } else if (input.toLowerCase() === 'n') {
      onConfirm([]);
    }
  });

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={1}>
        {assessments.map((a) => (
          <RepoRow key={a.repo.name} assessment={a} armed={false} />
        ))}
      </Box>
      <Box flexDirection="column">
        <Text color={color('red')}>{formatSummary(plan)}</Text>
        <ConsequencesList repos={plan.repos} target={plan.target} />
        <Box marginTop={1}>
          <Text>
            {dryRun ? '[dry-run] ' : ''}
            Proceed? (y/N)
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

/**
 * Caution batch: must type 'public' + Enter.
 */
function CautionConfirm({
  plan,
  dryRun,
  assessments,
  onConfirm,
}: {
  plan: ChangePlan;
  dryRun?: boolean;
  assessments: RepoAssessment[];
  onConfirm: (repos: Repo[]) => void;
}): JSX.Element {
  const color = useColor();
  const [buffer, setBuffer] = useState('');

  useInput((input, key) => {
    if (key.return) {
      if (buffer.trim().toLowerCase() === 'public') {
        onConfirm(plan.repos);
      }
      // wrong token: do nothing
      return;
    }
    if (key.backspace || key.delete) {
      setBuffer((prev) => prev.slice(0, -1));
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setBuffer((prev) => prev + input);
    }
  });

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={1}>
        {assessments.map((a) => (
          <RepoRow key={a.repo.name} assessment={a} armed={false} />
        ))}
      </Box>
      <Box flexDirection="column">
        <Text color={color('red')}>{formatSummary(plan)}</Text>
        <ConsequencesList repos={plan.repos} target={plan.target} />
        <Box marginTop={1}>
          <Text>
            {dryRun ? '[dry-run] ' : ''}
            Type &quot;public&quot; to confirm:
          </Text>
        </Box>
        <Box>
          <Text>{buffer}</Text>
          <Text color={color('gray')}>█</Text>
        </Box>
      </Box>
    </Box>
  );
}

/**
 * Danger batch: arm each danger repo by typing its exact name + Enter.
 * --force-public pre-arms all danger repos, reducing to caution-level confirm.
 */
function DangerConfirm({
  plan,
  dryRun,
  assessments,
  forcePublic,
  onConfirm,
}: {
  plan: ChangePlan;
  dryRun?: boolean;
  assessments: RepoAssessment[];
  forcePublic?: boolean;
  onConfirm: (repos: Repo[]) => void;
}): JSX.Element {
  const color = useColor();
  const dangerAssessments = assessments.filter((a) => a.severity === 'danger');

  const [armed, setArmed] = useState<Set<string>>(() => {
    if (forcePublic) {
      return new Set(dangerAssessments.map((a) => a.repo.name));
    }
    return new Set<string>();
  });

  const [buffer, setBuffer] = useState('');

  // When force-public is active, all danger are pre-armed → reduce to 'public' phrase confirm.
  // When not force-public, user arms repos one by one. After all are handled, Enter finalizes.
  const allArmedOrForce = forcePublic || dangerAssessments.every((a) => armed.has(a.repo.name));

  useInput((input, key) => {
    if (key.return) {
      const trimmed = buffer.trim();

      if (allArmedOrForce) {
        // All danger armed (or force-public): must type 'public' to confirm
        if (trimmed.toLowerCase() === 'public') {
          const toApply = assessments
            .filter((a) => a.severity !== 'danger' || armed.has(a.repo.name))
            .map((a) => a.repo);
          onConfirm(toApply);
        }
        // Wrong token: reset buffer, do nothing
        setBuffer('');
        return;
      }

      // Arming phase: check if typed name matches an unarmed danger repo
      const unarmed = dangerAssessments.filter((a) => !armed.has(a.repo.name));
      const matched = unarmed.find((a) => a.repo.name === trimmed);
      if (matched) {
        const newArmed = new Set(armed);
        newArmed.add(matched.repo.name);
        setBuffer('');

        // If all danger repos are now armed, auto-finalize immediately
        const stillUnarmed = dangerAssessments.filter((a) => !newArmed.has(a.repo.name));
        if (stillUnarmed.length === 0) {
          const toApply = assessments
            .filter((a) => a.severity !== 'danger' || newArmed.has(a.repo.name))
            .map((a) => a.repo);
          onConfirm(toApply);
          return;
        }

        setArmed(newArmed);
        return;
      }

      // No match: finalize with currently armed set
      // Unarmed danger repos are excluded (skipped)
      const toApply = assessments
        .filter((a) => a.severity !== 'danger' || armed.has(a.repo.name))
        .map((a) => a.repo);
      onConfirm(toApply);
      return;
    }

    if (key.backspace || key.delete) {
      setBuffer((prev) => prev.slice(0, -1));
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setBuffer((prev) => prev + input);
    }
  });

  const unarmedDanger = dangerAssessments.filter((a) => !armed.has(a.repo.name));

  const promptLabel = allArmedOrForce
    ? 'Type "public" to confirm (or Enter to cancel):'
    : unarmedDanger.length > 0
      ? `Type a danger repo name to arm it, or Enter to skip remaining:`
      : 'Type "public" to confirm:';

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={1}>
        {assessments.map((a) => (
          <RepoRow key={a.repo.name} assessment={a} armed={armed.has(a.repo.name)} />
        ))}
      </Box>
      <Box flexDirection="column">
        <Text color={color('red')}>{formatSummary(plan)}</Text>
        <ConsequencesList repos={plan.repos} target={plan.target} />
        <Box marginTop={1}>
          <Text>
            {dryRun ? '[dry-run] ' : ''}
            {promptLabel}
          </Text>
        </Box>
        <Box>
          <Text>{buffer}</Text>
          <Text color={color('gray')}>█</Text>
        </Box>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Public Confirm component
// ---------------------------------------------------------------------------

export function Confirm({
  plan,
  dryRun,
  assessments,
  forcePublic,
  onConfirm,
}: {
  plan: ChangePlan;
  dryRun?: boolean;
  /** Assessments from the scanning stage (public target only). */
  assessments?: RepoAssessment[];
  /** When true, danger repos are pre-armed (--force-public). */
  forcePublic?: boolean;
  /** Called with the subset of repos to apply. Empty array = cancel. */
  onConfirm: (reposToApply: Repo[]) => void;
}): JSX.Element {
  // Private target: use the simple unchanged private confirm.
  if (plan.target !== 'public' || !assessments || assessments.length === 0) {
    return <PrivateConfirm plan={plan} dryRun={dryRun} onConfirm={onConfirm} />;
  }

  const maxSeverity = batchSeverity(assessments);

  // --force-public with danger: treat as phrase-level (type 'public') but pre-arm danger.
  if (maxSeverity === 'danger') {
    return (
      <DangerConfirm
        plan={plan}
        dryRun={dryRun}
        assessments={assessments}
        forcePublic={forcePublic}
        onConfirm={onConfirm}
      />
    );
  }

  if (maxSeverity === 'caution') {
    return (
      <CautionConfirm
        plan={plan}
        dryRun={dryRun}
        assessments={assessments}
        onConfirm={onConfirm}
      />
    );
  }

  // Clean batch
  return (
    <CleanConfirm
      plan={plan}
      dryRun={dryRun}
      assessments={assessments}
      onConfirm={onConfirm}
    />
  );
}
