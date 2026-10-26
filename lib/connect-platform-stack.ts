import * as cdk from 'aws-cdk-lib/core';
import * as connect from 'aws-cdk-lib/aws-connect';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as customerprofiles from 'aws-cdk-lib/aws-customerprofiles';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as wisdom from 'aws-cdk-lib/aws-wisdom';
import { Construct } from 'constructs';
import type { StagePhoneNumber } from './stages';

// AmazonConnectServiceLinkedRolePolicy grants profile:* only on domains/amazon-connect-*.
const CUSTOMER_PROFILES_DOMAIN_PREFIX = 'amazon-connect-';

function customerProfilesDomainName(stage: string): string {
  const domainName = `${CUSTOMER_PROFILES_DOMAIN_PREFIX}${stage}-profiles`;
  if (!domainName.startsWith('amazon-connect-')) {
    throw new Error(
      `Customer Profiles domain "${domainName}" must start with amazon-connect- so the Connect service-linked role can call profile:* on it.`,
    );
  }
  return domainName;
}

export interface ConnectPlatformStackProps extends cdk.StackProps {
  readonly stage: string;
  readonly storageRetentionDays: number;
  readonly phoneNumbers: readonly StagePhoneNumber[];
}

export class ConnectPlatformStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ConnectPlatformStackProps) {
    super(scope, id, props);

    const instance = new connect.CfnInstance(this, 'Instance', {
      identityManagementType: 'CONNECT_MANAGED',
      instanceAlias: `chris-connect-${props.stage}`,
      attributes: {
        inboundCalls: true,
        outboundCalls: true,
        contactflowLogs: true,
        contactLens: true,
      },
    });
    instance.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

    new ssm.StringParameter(this, 'InstanceArnParameter', {
      parameterName: `/connect/${props.stage}/instance-arn`,
      stringValue: instance.attrArn,
    });

    new ssm.StringParameter(this, 'InstanceIdParameter', {
      parameterName: `/connect/${props.stage}/instance-id`,
      stringValue: instance.attrId,
    });

    new cdk.CfnOutput(this, 'InstanceArn', { value: instance.attrArn });
    new cdk.CfnOutput(this, 'InstanceId', { value: instance.attrId });

    const assistant = new wisdom.CfnAssistant(this, 'Assistant', {
      name: `chris-connect-${props.stage}-assistant`,
      type: 'AGENT',
    });
    assistant.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

    new connect.CfnIntegrationAssociation(this, 'WisdomAssistantAssociation', {
      instanceId: instance.attrArn,
      integrationType: 'WISDOM_ASSISTANT',
      integrationArn: assistant.attrAssistantArn,
    });

    new ssm.StringParameter(this, 'AssistantArnParameter', {
      parameterName: `/connect/${props.stage}/assistant-arn`,
      stringValue: assistant.attrAssistantArn,
    });

    new ssm.StringParameter(this, 'AssistantIdParameter', {
      parameterName: `/connect/${props.stage}/assistant-id`,
      stringValue: assistant.attrAssistantId,
    });

    const profilesDomain = new customerprofiles.CfnDomain(this, 'ProfilesDomain', {
      domainName: customerProfilesDomainName(props.stage),
      defaultExpirationDays: 366,
    });

    // Connect allows one Customer Profiles domain per instance. That association
    // is this CTR integration. Replacing it creates the new integration before
    // deleting the old one, so delete the previous integration first.
    // UpdateReplacePolicy Retain stops CloudFormation from calling
    // DeleteIntegration again on the integration this resource already removed.
    const previousProfilesDomainName = `chris-connect-${props.stage}-profiles`;
    const disassociatePreviousProfilesDomain = new cr.AwsCustomResource(this, 'DisassociatePreviousProfilesDomain', {
      onCreate: {
        service: 'CustomerProfiles',
        action: 'deleteIntegration',
        parameters: {
          DomainName: previousProfilesDomainName,
          Uri: instance.attrArn,
        },
        physicalResourceId: cr.PhysicalResourceId.of(`disassociate-previous-profiles-${props.stage}`),
        ignoreErrorCodesMatching: 'ResourceNotFoundException',
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ['profile:DeleteIntegration'],
          resources: [
            this.formatArn({
              service: 'profile',
              resource: 'domains',
              resourceName: `${previousProfilesDomainName}/integrations/*`,
            }),
          ],
        }),
      ]),
      installLatestAwsSdk: false,
    });

    const profilesIntegration = new customerprofiles.CfnIntegration(this, 'ProfilesIntegration', {
      domainName: profilesDomain.ref,
      uri: instance.attrArn,
      objectTypeName: 'CTR',
    });
    profilesIntegration.node.addDependency(disassociatePreviousProfilesDomain);
    // Retain only the resource CloudFormation replaces. Stack deletion still deletes
    // the integration that remains. Both policies are set so the split is explicit.
    profilesIntegration.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;
    profilesIntegration.cfnOptions.updateReplacePolicy = cdk.CfnDeletionPolicy.RETAIN;
    cdk.Annotations.of(profilesIntegration).acknowledgeWarning(
      'CloudFormation-Validate::W3011',
      'UpdateReplacePolicy is Retain so this domain replacement does not delete the previous integration twice. DeletionPolicy stays Delete so stack deletion removes the current integration.',
    );

    new ssm.StringParameter(this, 'ProfilesDomainNameParameter', {
      parameterName: `/connect/${props.stage}/profiles-domain-name`,
      stringValue: profilesDomain.ref,
    });

    const recordingsPrefix = 'call-recordings/';
    const transcriptsPrefix = 'chat-transcripts/';
    const reportsPrefix = 'scheduled-reports/';

    const storageBucket = new s3.Bucket(this, 'StorageBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: false,
      eventBridgeEnabled: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        { prefix: recordingsPrefix, expiration: cdk.Duration.days(props.storageRetentionDays) },
        { prefix: transcriptsPrefix, expiration: cdk.Duration.days(props.storageRetentionDays) },
      ],
    });

    for (const [resourceType, bucketPrefix] of [
      ['CALL_RECORDINGS', recordingsPrefix],
      ['CHAT_TRANSCRIPTS', transcriptsPrefix],
      ['SCHEDULED_REPORTS', reportsPrefix],
    ] as const) {
      new connect.CfnInstanceStorageConfig(this, resourceType, {
        instanceArn: instance.attrArn,
        resourceType,
        storageType: 'S3',
        s3Config: {
          bucketName: storageBucket.bucketName,
          bucketPrefix,
        },
      });
    }

    new ssm.StringParameter(this, 'StorageBucketParameter', {
      parameterName: `/connect/${props.stage}/storage-bucket`,
      stringValue: storageBucket.bucketName,
    });

    props.phoneNumbers.forEach((phoneNumber, index) => {
      const phone = new connect.CfnPhoneNumber(this, `PhoneNumber${index}`, {
        countryCode: phoneNumber.countryCode,
        type: phoneNumber.type,
        description: `ConnectPlatform-${props.stage}`,
        targetArn: instance.attrArn,
      });
      phone.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

      new ssm.StringParameter(this, `PhoneNumberArnParameter${index}`, {
        parameterName: `/connect/${props.stage}/phone-number-arn`,
        stringValue: phone.attrPhoneNumberArn,
      });
      new ssm.StringParameter(this, `PhoneNumberParameter${index}`, {
        parameterName: `/connect/${props.stage}/phone-number`,
        stringValue: phone.attrAddress,
      });
    });
  }
}
