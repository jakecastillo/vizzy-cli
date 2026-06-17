# Security Policy

## Supported versions

vizzy is pre-1.0. Security fixes are applied to the latest published release on
npm. Please make sure you're on the most recent version before reporting.

| Version | Supported |
|---------|-----------|
| latest  | ✅        |
| older   | ❌        |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report privately, one of these ways:

1. **GitHub Security Advisories** (preferred) — use the
   *Report a vulnerability* button under the repository's **Security** tab.
2. **Email** — jakecast@hawaii.edu

Please include:

- a description of the issue and its impact,
- steps to reproduce (or a proof of concept), and
- any suggested remediation if you have one.

You can expect an acknowledgement within a few days. Once a fix is ready, we'll
coordinate a release and credit you (unless you prefer to remain anonymous).

## Scope notes

vizzy reads a GitHub token (via the `gh` CLI or the `GITHUB_TOKEN` / `GH_TOKEN`
environment variables) and changes repository visibility through the GitHub API.
The token is never logged, printed, or written to disk. If you find a case where
a credential could leak, or where a destructive action can occur without the
explicit confirmation prompt, that's in scope — please report it.
