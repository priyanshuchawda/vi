# Contributing to QuickCut

This guide is mandatory for all contributors.

## Mandatory Rule

All contributors **must read and follow this file** before opening a PR.

## Project Standards

- Keep the app local-first, stable, and responsive.
- Prefer maintainable code over clever abstractions.
- Do not introduce secrets into code, logs, tests, or commits.
- AI provider is Bedrock-only (no Gemini code/deps/docs).

## AI Provider Policy (Bedrock Only)

QuickCut uses only AWS Bedrock.

- Default model: `amazon.nova-lite-v1:0`
- Model should be configurable from env:
  - Renderer hint: `VITE_BEDROCK_MODEL_ID`
  - Electron/main: `BEDROCK_MODEL_ID`
- Keep defaults pinned to `amazon.nova-lite-v1:0` in code and `.env.example`.
- New AI features must use existing Bedrock service/gateway patterns.

## PR Policy

- Long PRs and long changes are allowed when needed.
- But for **every change**, you must add/update tests in the relevant test
  file(s).
- A PR is not ready unless quality checks pass.
- Avoid mixing unrelated refactors with functional changes unless explicitly
  planned.

## Required Quality Gates (Must Pass)

Run these before opening/updating a PR:

```bash
npm run format:check
npm run typecheck
npm run build
npm run test
npm run lint
```

GitHub branch protection-compatible checks are:

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

See `docs/branch-protection-policy.md` for the canonical required-check policy.

Recommended additional checks:

```bash
npm run test:coverage
npx -y react-doctor@latest . --verbose --diff
```

Optional focused checks:

```bash
npm run test:watch
npm run test:memory
```

## Pre-commit

- Husky pre-commit hook runs `npm run pre-commit` (lint-staged).
- To install hooks after clone:

```bash
npm install
```

## Testing Requirements

- Every behavior change must have test coverage.
- Every bug fix should include a regression test.
- Update existing tests when behavior intentionally changes.
- Prefer deterministic tests (no network dependency in unit tests).
- Integration tests using local fixtures should skip gracefully when fixtures
  are missing.

### Minimum Test Types to Consider

- Unit tests: pure logic, utilities, stores, contracts.
- Component tests: rendering, interaction, accessibility basics.
- Integration tests: IPC/service boundaries, data flow, failure handling.

## React/Frontend Quality

- Run `react-doctor` for non-trivial UI changes.
- Keep keyboard accessibility intact for interactive UI.
- Avoid introducing hidden side effects in hooks.
- Prefer splitting very large components when touching them significantly.

## Security Rules

- Never hardcode credentials or API tokens.
- Keep secrets in `.env` only.
- Validate and constrain IPC usage; avoid exposing broad generic IPC invoke
  surfaces.
- Prefer typed APIs/contracts for renderer ↔ main communication.
- In GitHub workflows, pin all third-party actions to immutable commit SHAs.

## Code Organization

- `electron/`: main process, IPC, native integrations.
- `src/components/`: React UI.
- `src/lib/`: AI/services/utilities.
- `src/stores/`: Zustand stores.
- `src/types/`: shared TS contracts.
- `test/`: unit/component/integration tests.

## Commit and PR Hygiene

- Use clear, descriptive commit messages.
- Keep commits logically grouped.
- PR description must include:
  - What changed and why
  - Files/modules affected
  - Commands run and results
  - Risks, limitations, and follow-ups

## Documentation Rules

When behavior or workflow changes, update docs in the same PR:

- `README.md` for setup/run/architecture/user-facing flow
- `CONTRIBUTING.md` for engineering process/policy changes
- `docs/release-and-updates.md` for packaging/update/signing pipeline changes
- `docs/observability-and-telemetry.md` for logging/error-tracking changes
- `docs/storage-strategy.md` for persistence/storage behavior changes
- `docs/electron-security-checklist.md` for Electron security policy changes
- `docs/testing-hardening.md` for test matrix and coverage policy changes
