# AWS Production Hygiene

Use this document for the remaining low-cost production work after the backend,
landing deploy, and installed-app runtime path are already working.

## 1. Current Low-Cost Posture

Already in place:

- backend on `HTTP API Gateway + Lambda`
- metadata in `DynamoDB`
- videos / AI context in `S3`
- API access logs, Lambda log retention, and baseline alarms
- packaged desktop runtime config for Windows/Linux installers
- per-installation registration path for API Gateway mode

Still intentionally deferred:

- CI/CD
- custom domain
- ACM/TLS for landing
- CloudFront
- Cognito / full end-user auth

## 2. Dev vs Prod Separation

Do not treat the current `dev` stack as the final prod environment.

Use separate env files:

- `.env.aws.dev`
- `.env.aws.prod`

Start from:

- [../.env.aws.dev.example](../.env.aws.dev.example)
- [../.env.aws.prod.example](../.env.aws.prod.example)

Every AWS helper script supports either:

- `AWS_ENV_FILE=.env.aws.dev npm run aws:check:account`
- `npm run aws:deploy:cloud-backend -- --env-file .env.aws.prod`

Minimum separation rules:

- separate CloudFormation stack names
- separate S3 storage buckets
- separate DynamoDB tables
- separate landing bucket or landing prefix
- separate API URLs for packaged runtime config

## 3. What Is In IaC vs Still Manual

Currently managed in the backend stack:

- Lambda function
- API Gateway routes/integration
- Lambda role/policies
- API access log group
- baseline alarms
- client-installations table

Still external/manual today:

- primary storage bucket
- user profiles table
- channel analysis table
- user links table
- landing bucket / website hosting config
- account-level budgets / anomaly monitors

That means the repo is production-capable for the current dev rollout, but not
yet a full fresh-account prod bootstrap.

## 4. Cost Guardrails

Use the account audit before and after meaningful AWS changes:

```bash
npm run aws:check:account
AWS_ENV_FILE=.env.aws.prod npm run aws:check:account
```

Recommended minimum guardrails:

- one monthly `AWS Budgets` cost budget
- one forecasted-cost alert
- one anomaly monitor, if the account org policy allows it
- keep log retention at 14 days unless there is a compliance reason to increase
  it
- keep DynamoDB on `PAY_PER_REQUEST`
- keep Lambda outside a VPC

Some org-managed AWS accounts deny Cost Explorer anomaly APIs through SCPs. If
`aws:check:account` reports `access_denied` for anomaly monitors, that is an
account-policy dependency, not an app-code failure.

## 5. Recommended Next Step

Before calling the system fully production-ready, do one of these:

1. Keep using the current AWS-hosted endpoints and explicitly document that the
   deployment is a low-cost dev/live environment.
2. Provision dedicated prod buckets/tables and a separate prod stack using
   `.env.aws.prod`, then rerun the backend and baseline verification against
   that environment.
