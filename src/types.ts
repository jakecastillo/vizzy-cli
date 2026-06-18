export type Visibility = 'public' | 'private';
export type Target = Visibility;
export type Operation = 'visibility' | 'archive';

export interface Repo {
  name: string;
  owner: string;
  visibility: Visibility;
  isFork: boolean;
  isArchived: boolean;
  stars: number;
  pushedAt: string; // ISO 8601
  defaultBranch: string;
  license: string | null; // SPDX identifier or null
}

export interface ApplyResult {
  name: string;
  ok: boolean;
  error?: string;
}

export type VisibilitySetter = (
  owner: string,
  repo: string,
  visibility: Visibility,
) => Promise<void>;

/**
 * A generic per-repo mutation function. Used to generalize applyChanges
 * beyond visibility (e.g. archive/unarchive). Receives the full Repo object.
 */
export type RepoMutation = (repo: Repo) => Promise<void>;

export type RowStatus = 'pending' | 'applying' | 'done' | 'error';
