import * as cdk from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { defineConnectPlatform } from '../lib/stages';

test('sandbox template has the Connect instance, SSM params, and termination protection', () => {
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

  template.resourceCountIs('AWS::SSM::Parameter', 2);
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
