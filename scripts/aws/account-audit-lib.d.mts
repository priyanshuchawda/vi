export function buildStackName(projectName: string, environmentName: string): string;

export function getAuditTargets(env?: Record<string, string | undefined>): {
  projectName: string;
  region: string;
  currentStackName: string;
  devStackName: string;
  prodStackName: string;
  storageBucketName: string;
  landingBucketName: string;
  tables: {
    profiles: string;
    analysis: string;
    userLinks: string;
    installations: string;
  };
};

export function getManualResourceOwnershipNotes(targets: {
  currentStackName: string;
  storageBucketName: string;
  landingBucketName: string;
  tables: {
    profiles: string;
    analysis: string;
    userLinks: string;
    installations: string;
  };
}): {
  iacManagedNow: string[];
  externalOrManualToday: string[];
};
