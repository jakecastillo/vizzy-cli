import { useEffect, useState } from 'react';
import { Box, Text, useApp } from 'ink';
import type { CliFlags } from '../cli.js';
import type { Repo, Visibility, VisibilitySetter, RowStatus } from '../types.js';
import { eligibleRepos } from '../core/filter.js';
import { buildPlan } from '../core/plan.js';
import { applyChanges } from '../apply.js';
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
}

type Stage = 'target' | 'loading' | 'error' | 'empty' | 'select' | 'confirm' | 'applying' | 'done';

function initialTarget(flags: CliFlags): Visibility | null {
  if (flags.private) return 'private';
  if (flags.public) return 'public';
  return null;
}

export function App({
  flags,
  loadRepos,
  setter,
  onComplete = () => {},
}: AppProps): JSX.Element {
  const { exit } = useApp();
  const preset = initialTarget(flags);

  const [stage, setStage] = useState<Stage>(preset ? 'loading' : 'target');
  const [target, setTarget] = useState<Visibility | null>(preset);
  const [candidates, setCandidates] = useState<Repo[]>([]);
  const [selected, setSelected] = useState<Repo[]>([]);
  const [rows, setRows] = useState<ProgressRow[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [summary, setSummary] = useState('');

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
          setStage('confirm');
        }}
      />
    );

  if (stage === 'confirm' && target)
    return (
      <Confirm
        plan={buildPlan(target, selected)}
        dryRun={flags.dryRun}
        onConfirm={(yes) => {
          if (!yes) {
            setSummary('Cancelled.');
            setStage('done');
            onComplete(0);
            setTimeout(exit, 0);
          } else if (flags.dryRun) {
            setSummary(`[dry-run] Would change ${selected.length} repo(s) to ${target}.`);
            setStage('done');
            onComplete(0);
            setTimeout(exit, 0);
          } else {
            setStage('applying');
          }
        }}
      />
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
