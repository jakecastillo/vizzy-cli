import { useEffect, useState } from 'react';
import { Box, Text, useApp } from 'ink';
import Spinner from 'ink-spinner';
import type { CliFlags } from '../cli.js';
import type { Repo, Visibility, VisibilitySetter, RowStatus } from '../types.js';
import { eligibleRepos } from '../core/filter.js';
import { buildPlan } from '../core/plan.js';
import { applyChanges } from '../apply.js';
import { partitionProtected } from '../core/protected.js';
import { assessRepos, type TreeFetcher } from '../core/scan.js';
import type { RepoAssessment, AssessOptions } from '../core/checks.js';
import { TargetSelect } from './TargetSelect.js';
import { RepoList } from './RepoList.js';
import { Confirm } from './Confirm.js';
import { ApplyProgress, type ProgressRow } from './ApplyProgress.js';

export interface AppProps {
  flags: CliFlags;
  loadRepos: () => Promise<Repo[]>;
  setter: VisibilitySetter;
  /** Called once on any terminal state with the number of failed repos. */
  onComplete?: (failedCount: number) => void;
  /**
   * Injected tree fetcher — required for the public scanning stage.
   * Tests pass a stub (no network); bin.tsx passes the real listRepoTree wrapper.
   * Defaults to a no-op that returns empty trees so App works without it
   * (the scanning stage only runs when target==='public').
   */
  treeFetch?: TreeFetcher;
  /**
   * Glob patterns loaded from .vizzyignore (or []).
   * Passed by bin.tsx after reading cwd/.vizzyignore; missing file → [].
   */
  protectPatterns?: string[];
}

type Stage = 'target' | 'loading' | 'error' | 'empty' | 'select' | 'scanning' | 'confirm' | 'applying' | 'done';

function initialTarget(flags: CliFlags): Visibility | null {
  if (flags.private) return 'private';
  if (flags.public) return 'public';
  return null;
}

/** Default assess opts — deterministic enough for production use. */
const DEFAULT_ASSESS_OPTS: AssessOptions = {
  staleMonths: 12,
  highProfileStars: 10,
  now: new Date(),
};

export function App({
  flags,
  loadRepos,
  setter,
  onComplete = () => {},
  treeFetch,
  protectPatterns = [],
}: AppProps): JSX.Element {
  const { exit } = useApp();
  const preset = initialTarget(flags);

  const [stage, setStage] = useState<Stage>(preset ? 'loading' : 'target');
  const [target, setTarget] = useState<Visibility | null>(preset);
  const [candidates, setCandidates] = useState<Repo[]>([]);
  const [selected, setSelected] = useState<Repo[]>([]);
  const [rows, setRows] = useState<ProgressRow[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [scanError, setScanError] = useState('');
  const [summary, setSummary] = useState('');
  const [assessments, setAssessments] = useState<RepoAssessment[]>([]);
  const [protectedCount, setProtectedCount] = useState(0);
  const [scanRepos, setScanRepos] = useState<Repo[]>([]);

  // Load + filter once a target exists.
  useEffect(() => {
    if (stage !== 'loading' || !target) return;
    let cancelled = false;
    loadRepos()
      .then((repos) => {
        if (cancelled) return;
        const eligible = eligibleRepos(repos, target, {
          includeForks: flags.forks,
          includeArchived: Boolean(flags.includeArchived),
        });
        if (eligible.length === 0) {
          setStage('empty');
          onComplete(0);
          setTimeout(exit, 0);
        } else {
          setCandidates(eligible);
          setStage('select');
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setStage('error');
        onComplete(1);
        setTimeout(exit, 0);
      });
    return () => {
      cancelled = true;
    };
  }, [stage, target, flags, loadRepos, exit, onComplete]);

  // Scanning stage: only for public target.
  useEffect(() => {
    if (stage !== 'scanning' || target !== 'public') return;

    let cancelled = false;

    const run = async () => {
      // Protected filtering (pure) — applied for public unless --no-protect.
      // Computed and committed to `selected` BEFORE the scan so that even an
      // unexpected scan crash can never let a protected repo reach the apply
      // stage (the apply effect reads `selected`).
      let allowed: Repo[];
      let pCount = 0;
      if (flags.protect !== false) {
        const { allowed: a, protectedOut } = partitionProtected(scanRepos, protectPatterns);
        allowed = a;
        pCount = protectedOut.length;
      } else {
        allowed = scanRepos;
      }
      if (!cancelled) {
        setProtectedCount(pCount);
        setSelected(allowed);
      }

      // Run assessRepos with the injected fetcher (or a safe no-op fallback).
      // Per-repo fetch failures are already isolated inside assessRepos
      // (→ scan-incomplete); this outer catch is defence-in-depth.
      const fetcher: TreeFetcher =
        treeFetch ?? ((_repo) => Promise.resolve({ paths: [], truncated: false }));

      try {
        const results = await assessRepos(allowed, fetcher, {
          ...DEFAULT_ASSESS_OPTS,
          now: new Date(),
        });
        if (!cancelled) {
          setAssessments(results);
          setStage('confirm');
        }
      } catch (err) {
        // Unexpected scanning crash: surface the message and fail toward MORE
        // friction — mark every ALLOWED repo scan-incomplete (caution) and let
        // the user proceed to confirm. Protected repos are already excluded.
        if (!cancelled) {
          setScanError(err instanceof Error ? err.message : String(err));
          const fallback = allowed.map((r): RepoAssessment => ({
            repo: r,
            findings: [
              {
                kind: 'scan-incomplete',
                severity: 'caution',
                label: 'Scan error — results unavailable',
              },
            ],
            severity: 'caution',
            requiredConfirm: 'phrase',
          }));
          setAssessments(fallback);
          setStage('confirm');
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [stage, target, scanRepos, treeFetch, protectPatterns, flags.protect]);

  // Apply once confirmed.
  useEffect(() => {
    if (stage !== 'applying' || !target) return;
    setRows(selected.map((r) => ({ name: r.name, status: 'pending' as RowStatus })));
    applyChanges(selected, target, setter, {
      onProgress: (name, status, error) => {
        setRows((prev) =>
          prev.map((row) => (row.name === name ? { ...row, status, error } : row)),
        );
      },
    }).then((results) => {
      const failed = results.filter((r) => !r.ok).length;
      setSummary(`Done: ${results.length - failed} changed, ${failed} failed.`);
      setStage('done');
      onComplete(failed);
      setTimeout(exit, 0);
    });
  }, [stage, target, selected, setter, exit, onComplete]);

  if (stage === 'target')
    return (
      <TargetSelect
        onSelect={(t) => {
          setTarget(t);
          setStage('loading');
        }}
      />
    );

  if (stage === 'loading') return <Text>Loading your repositories…</Text>;
  if (stage === 'error') return <Text color="red">{errorMsg}</Text>;
  if (stage === 'empty')
    return <Text>Nothing to do — no repos need to change to {target}.</Text>;

  if (stage === 'select' && target)
    return (
      <RepoList
        repos={candidates}
        target={target}
        onSubmit={(sel) => {
          if (sel.length === 0) {
            setStage('done');
            setSummary('No repos selected.');
            onComplete(0);
            setTimeout(exit, 0);
            return;
          }
          setSelected(sel);
          if (target === 'public') {
            // Enter scanning stage before confirm.
            setScanRepos(sel);
            setStage('scanning');
          } else {
            setStage('confirm');
          }
        }}
      />
    );

  if (stage === 'scanning' && target === 'public') {
    const n = scanRepos.length;
    return (
      <Box flexDirection="column">
        <Box>
          <Text color="green">
            <Spinner type="dots" />
          </Text>
          <Text> Checking {n} repo(s) for exposure risk…</Text>
        </Box>
        {protectedCount > 0 && (
          <Text color="yellow">
            {protectedCount} repo(s) protected by .vizzyignore — hidden from public.
          </Text>
        )}
      </Box>
    );
  }

  if (stage === 'confirm' && target)
    return (
      <Box flexDirection="column">
        {scanError && (
          <Text color="red">
            ⚠ Scan incomplete: {scanError} — all repos marked needs-review.
          </Text>
        )}
        <Confirm
          plan={buildPlan(target, selected)}
          dryRun={flags.dryRun}
          assessments={assessments}
          forcePublic={flags.forcePublic}
          onConfirm={(reposToApply) => {
            if (reposToApply.length === 0) {
              setSummary('Cancelled.');
              setStage('done');
              onComplete(0);
              setTimeout(exit, 0);
            } else if (flags.dryRun) {
              setSummary(`[dry-run] Would change ${reposToApply.length} repo(s) to ${target}.`);
              setStage('done');
              onComplete(0);
              setTimeout(exit, 0);
            } else {
              setSelected(reposToApply);
              setStage('applying');
            }
          }}
        />
      </Box>
    );

  if (stage === 'applying' && target)
    return (
      <Box flexDirection="column">
        <ApplyProgress rows={rows} target={target} />
      </Box>
    );

  // done
  return <Text>{summary}</Text>;
}
