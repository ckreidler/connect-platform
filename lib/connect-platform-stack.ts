import * as cdk from 'aws-cdk-lib/core';
import * as connect from 'aws-cdk-lib/aws-connect';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface ConnectPlatformStackProps extends cdk.StackProps {
  readonly stage: string;
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
  }
}
