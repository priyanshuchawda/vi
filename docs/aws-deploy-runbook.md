# AWS Deploy Runbook

Use this runbook for the current low-cost AWS deployment path.

This runbook assumes:

- no custom domain yet
- no ACM certificate yet
- landing is served from the AWS S3 website endpoint
- backend is `HTTP API Gateway + Lambda`

## 1. Pre-Deploy Checks

- Ensure AWS credentials are valid: `aws sts get-caller-identity`
- Confirm the repo is on the intended commit from `main`
- Confirm `.env` points at the intended AWS dev environment
- Verify the local build/test baseline:
  - `npm run test -- test/electron/presignedHttpUpload.test.ts test/electron/cloudBackendApi.test.ts test/electron/cloudBackendService.test.ts test/backend/storageApiHandler.test.ts`
  - `npm run typecheck`
  - `npm run build:electron`
  - `npm run aws:build:cloud-backend`

## 2. Backend Deploy

Deploy the Lambda + API stack:

```bash
npm run aws:deploy:cloud-backend
```

Post-deploy verification:

```bash
npm run aws:verify:baseline
RUN_AWS_APIGW_LIVE_TESTS=1 npm run test -- test/backend/cloudBackendApiGateway.live.test.ts
```

## 3. Direct-Mode Safety Check

Before treating the phase as complete, confirm the existing fallback path still
works:

```bash
RUN_AWS_LIVE_TESTS=1 npm run test -- test/electron/awsStorage.live.test.ts
```

## 4. Landing Deploy

Preview first:

```bash
npm run aws:deploy:landing:dryrun
```

Deploy:

```bash
npm run aws:deploy:landing
```

Verify:

```bash
npm run aws:verify:baseline
```

## 5. Rollback

If a backend deploy is bad:

1. Revert the offending commit on a new branch.
2. Redeploy the backend from the reverted commit with
   `npm run aws:deploy:cloud-backend`.
3. Re-run `npm run aws:verify:baseline`.
4. Re-run the direct and API Gateway live tests.

If a landing deploy is bad:

1. Checkout the last known good commit.
2. Re-run `npm run aws:deploy:landing`.
3. Re-run `npm run aws:verify:baseline`.

## 6. Cost Notes

- Keep Lambda outside a VPC.
- Keep DynamoDB on `PAY_PER_REQUEST`.
- Keep uploads direct to S3 through presigned URLs.
- Keep log retention short unless compliance requires more.
- Delay CloudFront, ACM, Route53, Cognito, WAF, and heavier AWS services until
  they are actually needed.
