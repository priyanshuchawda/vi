# QuickCut AWS Rollout Plan

## Goal

Finish the AWS-backed production path without adding high-cost services and
without breaking the current direct AWS workflow during rollout.

## Status Snapshot

Completed in repo/AWS now:

- managed backend parity for API Gateway mode
- backend deploy automation
- landing deploy automation
- baseline alarms, logs, and verification
- packaged installer runtime config
- installation-based API Gateway credentials for installed apps

Still remaining beyond the current dev/live setup:

- account-level budgets
- anomaly detection where account policy allows it
- dedicated prod bucket/table/resource names and first prod rollout
- full user auth
- custom domain / CDN / TLS
- CI/CD

This plan reflects the current decisions:

- use AWS-managed endpoints for now
- no custom domain yet
- no ACM certificate yet
- keep costs low and architecture lean
- finish the missing AWS basics before adding polish

## Scope Lock

### Confirmed Now

- landing stays on an AWS-hosted endpoint for now
- backend stays on `HTTP API Gateway + Lambda`
- storage stays on `S3 + DynamoDB`
- `direct` mode remains as a fallback until `apigw` mode is proven stable
- no ECS, RDS, NAT Gateway, WAF, Amplify, or CloudFront in the current pass

### Deferred Intentionally

- custom domain
- TLS via ACM
- CloudFront
- Cognito or other full user auth
- release-signing expansion beyond the current required platform path

## Architecture We Are Shipping First

### Frontend

- static landing site in S3
- automated deploy from `landing/`
- AWS website endpoint used as the public URL for now

### Backend

- HTTP API Gateway as the control plane
- Lambda for metadata and presign flows
- S3 for videos, AI context, and memory files
- DynamoDB on `PAY_PER_REQUEST` for app metadata

### Cost Guardrails

- keep Lambda out of a VPC
- keep DynamoDB on-demand
- use presigned S3 uploads for exported videos
- avoid proxying large files through Lambda
- keep log retention short and explicit
- add only minimal alarms first

## Current Gaps

- API Gateway mode was not feature-complete for exported videos
- backend observability was minimal
- landing deployment was manual
- AWS resources are only partially codified
- operational checks are not yet standardized

## Delivery Phases

## Phase 1 - Managed Backend Completion

### Goal

Make `AWS_BACKEND_MODE=apigw` usable for the current storage feature set while
keeping `direct` mode untouched as fallback.

### Work

- add API routes for:
  - presigned exported-video upload plans
  - exported-video listing
- add Lambda IAM access for the `videos/` prefix only
- upload exported videos directly to S3 through presigned URLs
- keep exported video metadata shape aligned with direct mode
- add unit tests for API routes and service behavior
- add live API Gateway smoke coverage against AWS

### Exit Criteria

- local tests pass
- backend bundle builds
- deployed API Gateway flow can:
  - write/read metadata
  - upload an exported video
  - list exported videos

## Phase 2 - Backend Observability and Safe Deploys

### Goal

Make the current backend operable at low cost.

### Work

- add API Gateway access logs
- set explicit Lambda log retention
- add minimal CloudWatch alarms:
  - Lambda errors
  - Lambda throttles
  - API Gateway 5xx
- keep alarm wiring optional through an SNS topic input
- keep deployment automated through repo scripts

### Exit Criteria

- stack deploy is repeatable from this repo
- log retention is set
- alarms exist in AWS
- recent smoke requests appear in logs

## Phase 3 - Landing Deploy Automation

### Goal

Make landing deployment reproducible without changing the current low-cost
hosting shape.

### Work

- add a repo deploy script for `landing/`
- support a dedicated bucket or a prefix inside a bucket
- keep cache behavior safe for non-versioned files
- verify bucket existence before sync
- dry-run before real deploy
- smoke-test the S3 website endpoint after deploy

### Exit Criteria

- landing deploy can be run from the repo
- dry-run output is readable
- real sync completes cleanly
- website endpoint still serves the landing page

## Phase 4 - Production Hygiene

### Goal

Add the minimum operational safety needed for a small production system.

### Work

- define a standard smoke-test checklist
- document rollout and rollback steps
- add budget and anomaly-detection setup instructions
- separate `dev` and future `prod` environment values more clearly
- identify which AWS resources still need full IaC ownership
- add an AWS account audit script so the current account state is checkable from
  the repo

### Exit Criteria

- deployment steps are documented
- rollback path is clear
- cost monitoring setup is defined
- current AWS account state can be audited from the repo

## Phase 5 - Deferred Hardening

### Goal

List the next upgrades that matter, but do not block the current rollout.

### Later Work

- move from shared bearer token to real user auth
- add CloudFront + ACM + custom domain
- add CI/CD for landing and backend deploys
- tighten resource tagging and cost reporting
- add stronger security controls once traffic justifies them

## Execution Order Right Now

1. Finish and test Phase 1 locally.
2. Deploy the backend stack to the current AWS dev environment.
3. Run direct-mode and API-Gateway live tests against AWS.
4. Finish and test Phase 2 observability changes in AWS.
5. Dry-run and execute Phase 3 landing deployment.
6. Create a PR for the completed phase set, merge it, and then continue.

## Important Note

Using the raw S3 website endpoint without TLS is acceptable only as a temporary
AWS-hosted step. It is not the final public production posture. We are deferring
that intentionally to keep the current pass cheap and focused.
