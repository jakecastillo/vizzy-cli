import pLimit from 'p-limit';
import type { Repo, Visibility, ApplyResult, VisibilitySetter, RepoMutation, RowStatus } from './types.js';

export interface ApplyOptions {
  concurrency?: number;
  onProgress?: (name: string, status: RowStatus, error?: string) => void;
}

/**
 * Apply a change to each repo in `repos` with a concurrency cap.
 * Errors are caught per-repo so the batch always completes; results preserve input order.
 *
 * Overload 1 (visibility setter — original signature, preserved for compatibility):
 *   applyChanges(repos, target, setter, opts?)
 *
 * Overload 2 (generic mutation — archive/unarchive or any per-repo async op):
 *   applyChanges(repos, mutation, opts?)
 */
export async function applyChanges(
  repos: Repo[],
  target: Visibility,
  setter: VisibilitySetter,
  opts?: ApplyOptions,
): Promise<ApplyResult[]>;
export async function applyChanges(
  repos: Repo[],
  mutation: RepoMutation,
  opts?: ApplyOptions,
): Promise<ApplyResult[]>;
export async function applyChanges(
  repos: Repo[],
  targetOrMutation: Visibility | RepoMutation,
  setterOrOpts?: VisibilitySetter | ApplyOptions,
  optsArg?: ApplyOptions,
): Promise<ApplyResult[]> {
  // Resolve the effective mutation function and options.
  let mutate: (r: Repo) => Promise<void>;
  let opts: ApplyOptions;

  if (typeof targetOrMutation === 'function') {
    // Overload 2: applyChanges(repos, mutation, opts?)
    mutate = targetOrMutation;
    opts = (setterOrOpts as ApplyOptions | undefined) ?? {};
  } else {
    // Overload 1: applyChanges(repos, target, setter, opts?)
    const target = targetOrMutation;
    const setter = setterOrOpts as VisibilitySetter;
    mutate = (r: Repo) => setter(r.owner, r.name, target);
    opts = optsArg ?? {};
  }

  const limit = pLimit(opts.concurrency ?? 5);
  return Promise.all(
    repos.map((r) =>
      limit(async (): Promise<ApplyResult> => {
        opts.onProgress?.(r.name, 'applying');
        try {
          await mutate(r);
          opts.onProgress?.(r.name, 'done');
          return { name: r.name, ok: true };
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          opts.onProgress?.(r.name, 'error', error);
          return { name: r.name, ok: false, error };
        }
      }),
    ),
  );
}
