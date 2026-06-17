import type { Repo, Target } from '../types.js';

export interface ChangePlan {
  target: Target;
  repos: Repo[];
}

export function buildPlan(target: Target, repos: Repo[]): ChangePlan {
  return { target, repos };
}

export function formatSummary(plan: ChangePlan): string {
  const count = plan.repos.length;
  const noun = count === 1 ? 'repo' : 'repos';
  const list = plan.repos.map((r) => `  - ${r.name}`).join('\n');
  const headline = `Making ${count} ${noun} ${plan.target.toUpperCase()}:`;
  if (plan.target === 'public') {
    return `⚠ ${headline}\n  This will EXPOSE their code publicly.\n${list}`;
  }
  return `${headline}\n${list}`;
}
