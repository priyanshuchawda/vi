# Branch Protection Policy (main)

This policy defines required repository settings for `main`.

## Required Protections

- Require a pull request before merging.
- Require approvals: minimum 1 approving review.
- Dismiss stale approvals when new commits are pushed.
- Require conversation resolution before merge.
- Require status checks to pass before merge.
- Require branches to be up to date before merge.
- Restrict force pushes and branch deletion.
- Include administrators in enforcement.

## Required Status Checks

The following checks must be required on `main`:

- `Quality Gates (ubuntu-latest)`
- `Quality Gates (macos-latest)`
- `Quality Gates (windows-latest)`
- `Verify package-lock is in sync`
- `Lint GitHub workflows`
- `Lint shell scripts`
- `Markdown lint`
- `Link check`
- `Analyze (JavaScript/TypeScript)`
- `Package Smoke (ubuntu-latest)`
- `Package Smoke (macos-latest)`
- `Package Smoke (windows-latest)`
- `Verify ThirdPartyNotices is in sync`

All workflow `uses:` references must be pinned to immutable commit SHAs.

## Merge Strategy

- Allow `Squash` and `Merge commit`.
- Disallow direct pushes to `main`.
- Prefer squash for feature/fix branches with many incremental commits.

## Ownership and Governance

- CODEOWNERS must remain enabled.
- Security-sensitive areas (`electron/`, `electron/preload.ts`,
  `electron/main.ts`) require owner review.

## Operational Procedure

When workflows or check names change:

1. Update this policy document in the same PR.
2. Update GitHub branch protection settings to match.
3. Confirm `main` is enforcing the new required check names.
