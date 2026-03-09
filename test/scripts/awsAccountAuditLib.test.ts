// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  buildStackName,
  getAuditTargets,
  getManualResourceOwnershipNotes,
} from '../../scripts/aws/account-audit-lib.mjs';

describe('aws account audit lib', () => {
  it('builds the default dev/prod stack names', () => {
    const targets = getAuditTargets({});

    expect(buildStackName('quickcut', 'dev')).toBe('quickcut-cloud-backend-dev');
    expect(targets.devStackName).toBe('quickcut-cloud-backend-dev');
    expect(targets.prodStackName).toBe('quickcut-cloud-backend-prod');
    expect(targets.currentStackName).toBe('quickcut-cloud-backend-dev');
  });

  it('honors explicit stack overrides', () => {
    const targets = getAuditTargets({
      AWS_CLOUDBACKEND_PROJECT_NAME: 'qc',
      AWS_CLOUDBACKEND_STACK_NAME: 'custom-current',
      AWS_CLOUDBACKEND_DEV_STACK_NAME: 'custom-dev',
      AWS_CLOUDBACKEND_PROD_STACK_NAME: 'custom-prod',
      AWS_S3_BUCKET: 'storage-bucket',
      AWS_LANDING_BUCKET: 'landing-bucket',
    });

    expect(targets.currentStackName).toBe('custom-current');
    expect(targets.devStackName).toBe('custom-dev');
    expect(targets.prodStackName).toBe('custom-prod');
    expect(targets.storageBucketName).toBe('storage-bucket');
    expect(targets.landingBucketName).toBe('landing-bucket');
  });

  it('reports which resources are still outside the backend stack', () => {
    const notes = getManualResourceOwnershipNotes({
      currentStackName: 'quickcut-cloud-backend-dev',
      storageBucketName: 'quickcut-storage',
      landingBucketName: 'quickcut-landing',
      tables: {
        profiles: 'profiles',
        analysis: 'analysis',
        userLinks: 'links',
        installations: 'installations',
      },
    });

    expect(notes.iacManagedNow).toContain('quickcut-cloud-backend-dev CloudFormation stack');
    expect(notes.externalOrManualToday).toContain('Primary storage bucket (quickcut-storage)');
    expect(notes.externalOrManualToday).toContain('AWS Budgets / Cost Anomaly Detection account settings');
  });
});
