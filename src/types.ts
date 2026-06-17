export type Visibility = 'public' | 'private';
export type Target = Visibility;

export interface Repo {
  name: string;
  owner: string;
  visibility: Visibility;
  isFork: boolean;
  isArchived: boolean;
  stars: number;
  pushedAt: string; // ISO 8601
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

export type RowStatus = 'pending' | 'applying' | 'done' | 'error';
