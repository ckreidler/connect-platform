import * as cdk from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { defineConnectPlatform } from '../lib/stages';

test('sandbox template has the Connect instance, storage, phone number, assistant, and SSM params', () => {
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

  template.resourceCountIs('AWS::Connect::IntegrationAssociation', 1);
  template.hasResourceProperties('AWS::Connect::IntegrationAssociation', {
    InstanceId: { 'Fn::GetAtt': [instanceLogicalId, 'Arn'] },
    IntegrationType: 'WISDOM_ASSISTANT',
    IntegrationArn: { 'Fn::GetAtt': [assistantLogicalId, 'AssistantArn'] },
  });
  const association = template.findResources('AWS::Connect::IntegrationAssociation');
  expect(Object.keys(association)).toEqual(['WisdomAssistantAssociation']);
  expect(association.WisdomAssistantAssociation.DeletionPolicy).toBeUndefined();

  template.resourceCountIs('AWS::SSM::Parameter', 7);
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
