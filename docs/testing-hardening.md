# Testing Hardening Matrix

This matrix maps automated tests to runtime risk areas.

## Risk Area Coverage

### IPC contract failures

- `test/electron/ipcContracts.test.ts`
- Covers malformed payload rejection and schema contract hardening.

### Electron security regressions

- `test/electron/securityPolicy.test.ts`
- Covers external URL allowlist, navigation blocking, permission default-deny,
  CSP baseline output.

### Persistence regressions

- `test/lib/storage.test.ts`
- `test/stores/useProjectStore.test.ts` (sidebar tab persistence)
- Covers namespaced storage keys and safe read/write behavior.

### Cloud storage regressions

- `test/electron/channelAnalysisService.test.ts`
- Covers user-to-channel linking compatibility for both direct channel IDs and
  YouTube URLs.

### Optional live AWS validation

- `test/electron/awsStorage.live.test.ts`
- Validates real DynamoDB and S3 round-trips through `AwsStorageService`.
- Skipped by default unless `RUN_AWS_LIVE_TESTS=1`.

### Core editor runtime flows

- Existing integration tests under `test/integration/`
- Includes timeline editing and transcription integration checks.

## Optional E2E Smoke Path

An optional Playwright smoke path validates top-level editor shell availability.

Files:

- `playwright.config.ts`
- `test/e2e/smoke.spec.ts`

Run manually (optional):

```bash
# start app UI first (dev server)
npm run dev:react

# in another shell
RUN_E2E_SMOKE=1 E2E_BASE_URL=http://localhost:7377 npm run test:e2e:smoke
```

By default, smoke tests are skipped unless `RUN_E2E_SMOKE=1`.
