# Release Go/No-Go Runbook

Use this checklist before publishing any production QuickCut release.

## 1. Scope and Freeze

- Confirm target version (`vX.Y.Z`) and changelog scope are finalized.
- Freeze merges to `main` except release blockers.
- Ensure all linked milestone issues/PRs are closed or deferred explicitly.

## 2. CI and Quality Gates

- Latest `main` commit has green CI on all required jobs.
- Cross-platform quality gates pass (Linux/macOS/Windows).
- Security automation passes (CodeQL and automation lint workflows).
- No unresolved release-blocking incidents.

## 3. Build and Packaging Validation

- `npm run build` passes on release commit.
- `npm run dist:linux` (or target platform builds) succeeds in CI.
- Artifact names include target version and correct architecture.
- Installer launches and app starts successfully.

## 4. Update and Migration Validation

- Auto-update path validated from previous stable version.
- `update:status` emits expected sequence during check/download/install.
- Backward compatibility validated for persisted user data.
- Any storage/schema migration has rollback guidance.

## 5. Security and Secrets Validation

- Release token and signing secrets are present in CI, not source control.
- No accidental secret exposure in logs/artifacts.
- Electron security posture unchanged (`contextIsolation`, `nodeIntegration`,
  IPC validation).

## 6. Release Decision

A release is `GO` only if every section above is complete.

If any blocking item is open, status is `NO-GO` and a new release candidate is
required.

## 7. Publish and Verify

1. Create and push release tag: `vX.Y.Z`.
2. Monitor `Release Desktop` workflow to completion.
3. Verify GitHub Release assets and metadata.
4. Smoke test install/update from published artifact.

## 8. Rollback Procedure

If post-release critical regression is confirmed:

1. Disable update rollout (or unpublish/update release metadata).
2. Publish patched hotfix version (`vX.Y.Z+1`) from fixed commit.
3. Document incident timeline and remediation actions.
4. Create follow-up issues for prevention and test coverage gaps.
