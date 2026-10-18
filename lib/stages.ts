import * as cdk from 'aws-cdk-lib/core';
import { ConnectPlatformStack } from './connect-platform-stack';

export interface StagePhoneNumber {
  readonly countryCode: string;
  readonly type: string;
}

export interface StageConfig {
  readonly account: string;
  readonly region: string;
  readonly storageRetentionDays: number;
  readonly phoneNumbers: readonly StagePhoneNumber[];
}

export const stages = {
  sandbox: {
    account: '945777367807',
    get region(): string {
      const region = process.env.CDK_DEFAULT_REGION;
      if (!region) {
        throw new Error('CDK_DEFAULT_REGION is required');
      }
      return region;
    },
    storageRetentionDays: 30,
    phoneNumbers: [{ countryCode: 'US', type: 'DID' }],
  },
} satisfies Record<string, StageConfig>;

export function resolveStage(app: cdk.App): { stage: keyof typeof stages; config: StageConfig } {
  const requested = app.node.tryGetContext('stage');
  if (typeof requested !== 'string' || !isStage(requested)) {
    throw new Error(
      `stage context is required and must be one of: ${Object.keys(stages).join(', ')}. Example: cdk deploy -c stage=sandbox`,
    );
  }
  return { stage: requested, config: stages[requested] };
}

export function defineConnectPlatform(app: cdk.App): cdk.App {
  const { stage, config } = resolveStage(app);
  new ConnectPlatformStack(app, `ConnectPlatform-${stage}`, {
    stackName: `ConnectPlatform-${stage}`,
    env: {
      account: config.account,
      region: config.region,
    },
    terminationProtection: true,
    stage,
    storageRetentionDays: config.storageRetentionDays,
    phoneNumbers: config.phoneNumbers,
  });
  return app;
}

function isStage(stage: string): stage is keyof typeof stages {
  return Object.prototype.hasOwnProperty.call(stages, stage);
}
