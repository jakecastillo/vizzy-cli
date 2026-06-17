import pLimit from 'p-limit';
import type { Repo, Visibility, ApplyResult, VisibilitySetter, RowStatus } from './types.js';

export interface ApplyOptions {
  concurrency?: number;
  onProgress?: (name: string, status: RowStatus, error?: string) => void;
}

/**
 * Apply `target` visibility to each repo using the injected setter, with a
 * concurrency cap. Errors are caught per-repo so the batch always completes;
 * results preserve input order.
 */
export async function applyChanges(
  repos: Repo[],
  target: Visibility,
  setter: VisibilitySetter,
  opts: ApplyOptions = {},
): Promise<ApplyResult[]> {
  const limit = pLimit(opts.concurrency ?? 5);
  return Promise.all(
    repos.map((r) =>
      limit(async (): Promise<ApplyResult> => {
        opts.onProgress?.(r.name, 'applying');
        try {
          await setter(r.owner, r.name, target);
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
