import * as cdk from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { defineConnectPlatform } from '../lib/stages';

test('sandbox template has the Connect instance, storage, phone number, assistant, profiles, and SSM params', () => {
  process.env.CDK_DEFAULT_REGION = 'us-east-1';

  const app = defineConnectPlatform(new cdk.App({ context: { stage: 'sandbox' } }));
  const assembly = app.synth();
  const artifact = assembly.getStackByName('ConnectPlatform-sandbox');
  expect(artifact.stackName).toBe('ConnectPlatform-sandbox');
  expect(artifact.environment).toEqual({
    account: '945777367807',
    region: 'us-east-1',
    name: 'aws://945777367807/us-east-1',
  });
  expect(artifact.terminationProtection).toBe(true);

  const template = Template.fromJSON(artifact.template);
  template.resourceCountIs('AWS::Connect::Instance', 1);
  template.hasResource('AWS::Connect::Instance', {
    DeletionPolicy: 'Retain',
    UpdateReplacePolicy: 'Retain',
    Properties: {
      IdentityManagementType: 'CONNECT_MANAGED',
      InstanceAlias: 'chris-connect-sandbox',
      Attributes: Match.objectEquals({
        InboundCalls: true,
        OutboundCalls: true,
        ContactflowLogs: true,
        ContactLens: true,
      }),
    },
  });

  const instanceLogicalId = Object.keys(template.findResources('AWS::Connect::Instance'))[0];
  expect(instanceLogicalId).toBe('Instance');

  template.resourceCountIs('AWS::S3::Bucket', 1);
  template.resourceCountIs('AWS::KMS::Key', 0);
  template.resourceCountIs('AWS::Kinesis::Stream', 0);
  const bucketLogicalId = Object.keys(template.findResources('AWS::S3::Bucket'))[0];
  template.hasResource('AWS::S3::Bucket', {
    DeletionPolicy: 'Retain',
    UpdateReplacePolicy: 'Retain',
    Properties: {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          { ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
        ],
      },
      LifecycleConfiguration: {
        Rules: Match.arrayEquals([
          Match.objectLike({
            Prefix: 'call-recordings/',
            ExpirationInDays: 30,
            Status: 'Enabled',
          }),
          Match.objectLike({
            Prefix: 'chat-transcripts/',
            ExpirationInDays: 30,
            Status: 'Enabled',
          }),
        ]),
      },
    },
  });
  const bucket = template.findResources('AWS::S3::Bucket')[bucketLogicalId];
  expect(bucket.Properties.VersioningConfiguration).toBeUndefined();

  template.hasResourceProperties('AWS::S3::BucketPolicy', {
    Bucket: { Ref: bucketLogicalId },
    PolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({
          Effect: 'Deny',
          Condition: { Bool: { 'aws:SecureTransport': 'false' } },
        }),
      ]),
    },
  });

  expect(bucketLogicalId.startsWith('StorageBucket')).toBe(true);
  template.resourceCountIs('Custom::S3BucketNotifications', 1);
  template.hasResourceProperties('Custom::S3BucketNotifications', {
    BucketName: { Ref: bucketLogicalId },
    NotificationConfiguration: Match.objectEquals({
      EventBridgeConfiguration: Match.objectEquals({}),
    }),
  });

  template.resourceCountIs('AWS::Connect::InstanceStorageConfig', 3);
  for (const [resourceType, bucketPrefix] of [
    ['CALL_RECORDINGS', 'call-recordings/'],
    ['CHAT_TRANSCRIPTS', 'chat-transcripts/'],
    ['SCHEDULED_REPORTS', 'scheduled-reports/'],
  ]) {
    template.hasResourceProperties('AWS::Connect::InstanceStorageConfig', {
      InstanceArn: { 'Fn::GetAtt': [instanceLogicalId, 'Arn'] },
      ResourceType: resourceType,
      StorageType: 'S3',
      S3Config: {
        BucketName: { Ref: bucketLogicalId },
        BucketPrefix: bucketPrefix,
      },
    });
  }

  template.resourceCountIs('AWS::Connect::PhoneNumber', 1);
  template.hasResource('AWS::Connect::PhoneNumber', {
    DeletionPolicy: 'Retain',
    UpdateReplacePolicy: 'Retain',
    Properties: {
      CountryCode: 'US',
      Type: 'DID',
      Description: 'ConnectPlatform-sandbox',
      TargetArn: { 'Fn::GetAtt': [instanceLogicalId, 'Arn'] },
    },
  });
  const phoneLogicalId = Object.keys(template.findResources('AWS::Connect::PhoneNumber'))[0];

  template.resourceCountIs('AWS::Wisdom::Assistant', 1);
  template.hasResource('AWS::Wisdom::Assistant', {
    DeletionPolicy: 'Retain',
    UpdateReplacePolicy: 'Retain',
    Properties: {
      Name: 'chris-connect-sandbox-assistant',
      Type: 'AGENT',
    },
  });
  const assistantLogicalId = Object.keys(template.findResources('AWS::Wisdom::Assistant'))[0];
  expect(assistantLogicalId).toBe('Assistant');
  const assistant = template.findResources('AWS::Wisdom::Assistant')[assistantLogicalId];
  expect(assistant.Properties.ServerSideEncryptionConfiguration).toBeUndefined();

  template.resourceCountIs('AWS::CustomerProfiles::Domain', 1);
  template.resourceCountIs('AWS::CustomerProfiles::EventStream', 0);
  template.hasResource('AWS::CustomerProfiles::Domain', {
    Properties: Match.objectEquals({
      DomainName: 'amazon-connect-sandbox-profiles',
      DefaultExpirationDays: 366,
    }),
  });
  const profilesDomainLogicalId = Object.keys(template.findResources('AWS::CustomerProfiles::Domain'))[0];
  expect(profilesDomainLogicalId).toBe('ProfilesDomain');
  const profilesDomain = template.findResources('AWS::CustomerProfiles::Domain')[profilesDomainLogicalId];
  expect(profilesDomain.Properties.DomainName.startsWith('amazon-connect-')).toBe(true);
  expect(profilesDomain.DeletionPolicy).toBeUndefined();
  expect(profilesDomain.UpdateReplacePolicy).toBeUndefined();

  template.resourceCountIs('AWS::CustomerProfiles::Integration', 1);
  template.hasResource('AWS::CustomerProfiles::Integration', {
    UpdateReplacePolicy: 'Retain',
    Properties: Match.objectEquals({
      DomainName: { Ref: profilesDomainLogicalId },
      Uri: { 'Fn::GetAtt': [instanceLogicalId, 'Arn'] },
      ObjectTypeName: 'CTR',
    }),
  });
  const profilesIntegration = template.findResources('AWS::CustomerProfiles::Integration');
  expect(Object.keys(profilesIntegration)).toEqual(['ProfilesIntegration']);
  expect(profilesIntegration.ProfilesIntegration.DeletionPolicy).toBe('Delete');

  template.resourceCountIs('Custom::AWS', 1);
  const disassociateLogicalId = Object.keys(template.findResources('Custom::AWS'))[0];
  const disassociate = template.findResources('Custom::AWS')[disassociateLogicalId];
  expect(disassociate.Properties.InstallLatestAwsSdk).toBe(false);
  const createCall = JSON.parse(disassociate.Properties.Create['Fn::Join'][1].filter((part: unknown) => typeof part === 'string').join(''));
  expect(createCall.service).toBe('CustomerProfiles');
  expect(createCall.action).toBe('deleteIntegration');
  expect(createCall.parameters.DomainName).toBe('chris-connect-sandbox-profiles');
  expect(createCall.ignoreErrorCodesMatching).toBe('ResourceNotFoundException');
  expect(createCall.physicalResourceId.id).toBe('disassociate-previous-profiles-sandbox');
  const integrationDependsOn = profilesIntegration.ProfilesIntegration.DependsOn;
  const integrationDependencies = Array.isArray(integrationDependsOn) ? integrationDependsOn : [integrationDependsOn];
  expect(integrationDependencies).toContain(disassociateLogicalId);

  template.hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({
          Effect: 'Allow',
          Action: 'profile:DeleteIntegration',
          Resource: {
            'Fn::Join': [
              '',
              [
                'arn:',
                { Ref: 'AWS::Partition' },
                ':profile:us-east-1:945777367807:domains/chris-connect-sandbox-profiles/integrations/*',
              ],
            ],
          },
        }),
      ]),
    },
  });

  template.resourceCountIs('AWS::Cases::Domain', 0);
  template.resourceCountIs('AWS::Cases::Field', 0);
  template.resourceCountIs('AWS::Cases::Template', 0);
  template.resourceCountIs('AWS::Cases::Layout', 0);

  template.resourceCountIs('AWS::Connect::IntegrationAssociation', 1);
  template.hasResourceProperties('AWS::Connect::IntegrationAssociation', {
    InstanceId: { 'Fn::GetAtt': [instanceLogicalId, 'Arn'] },
    IntegrationType: 'WISDOM_ASSISTANT',
    IntegrationArn: { 'Fn::GetAtt': [assistantLogicalId, 'AssistantArn'] },
  });
  const association = template.findResources('AWS::Connect::IntegrationAssociation');
  expect(Object.keys(association)).toEqual(['WisdomAssistantAssociation']);
  expect(association.WisdomAssistantAssociation.DeletionPolicy).toBeUndefined();

  template.resourceCountIs('AWS::SSM::Parameter', 8);
  template.hasResourceProperties('AWS::SSM::Parameter', {
    Name: '/connect/sandbox/instance-arn',
    Type: 'String',
    Value: { 'Fn::GetAtt': [instanceLogicalId, 'Arn'] },
  });
  template.hasResourceProperties('AWS::SSM::Parameter', {
    Name: '/connect/sandbox/instance-id',
    Type: 'String',
    Value: { 'Fn::GetAtt': [instanceLogicalId, 'Id'] },
  });
  template.hasResourceProperties('AWS::SSM::Parameter', {
    Name: '/connect/sandbox/storage-bucket',
    Type: 'String',
    Value: { Ref: bucketLogicalId },
  });
  template.hasResourceProperties('AWS::SSM::Parameter', {
    Name: '/connect/sandbox/phone-number-arn',
    Type: 'String',
    Value: { 'Fn::GetAtt': [phoneLogicalId, 'PhoneNumberArn'] },
  });
  template.hasResourceProperties('AWS::SSM::Parameter', {
    Name: '/connect/sandbox/phone-number',
    Type: 'String',
    Value: { 'Fn::GetAtt': [phoneLogicalId, 'Address'] },
  });
  template.hasResourceProperties('AWS::SSM::Parameter', {
    Name: '/connect/sandbox/assistant-arn',
    Type: 'String',
    Value: { 'Fn::GetAtt': [assistantLogicalId, 'AssistantArn'] },
  });
  template.hasResourceProperties('AWS::SSM::Parameter', {
    Name: '/connect/sandbox/assistant-id',
    Type: 'String',
    Value: { 'Fn::GetAtt': [assistantLogicalId, 'AssistantId'] },
  });
  template.hasResourceProperties('AWS::SSM::Parameter', {
    Name: '/connect/sandbox/profiles-domain-name',
    Type: 'String',
    Value: { Ref: profilesDomainLogicalId },
  });
  const parameterNames = Object.values(template.findResources('AWS::SSM::Parameter')).map(
    (parameter) => parameter.Properties.Name,
  );
  expect(parameterNames).not.toContain('/connect/sandbox/cases-domain-id');
  expect(parameterNames).not.toContain('/connect/sandbox/cases-domain-arn');

  const outputs = template.findOutputs('*');
  expect(Object.keys(outputs).sort()).toEqual(['InstanceArn', 'InstanceId']);
  for (const output of Object.values(outputs)) {
    expect(output).not.toHaveProperty('Export');
  }

  expect(artifact.template.Outputs.InstanceArn.Value).toEqual({ 'Fn::GetAtt': [instanceLogicalId, 'Arn'] });
  expect(artifact.template.Outputs.InstanceId.Value).toEqual({ 'Fn::GetAtt': [instanceLogicalId, 'Id'] });
});

test('synth fails without a valid stage', () => {
  expect(() => defineConnectPlatform(new cdk.App()).synth()).toThrow(/stage/);
  expect(() => defineConnectPlatform(new cdk.App({ context: { stage: 'prod' } })).synth()).toThrow(/stage/);
});
