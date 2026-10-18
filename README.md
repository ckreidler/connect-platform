# Connect platform

Long-lived Amazon Connect base stack. Other CDK apps deploy features onto the instance this stack creates.

The stack creates one Connect instance (`CONNECT_MANAGED`, inbound and outbound calls, contact flow logs, Contact Lens) and publishes its ARN and ID. It does not claim a phone number. Termination protection is on, and the instance is retained on stack delete.

Agent guidance for AWS work in this repo is in [.cursor/rules/aws.mdc](.cursor/rules/aws.mdc).

## Stages

Stage is required context and must be a key in `stages` (`lib/stages.ts`). `sandbox` is the only entry: account `945777367807`, region `CDK_DEFAULT_REGION` (the CDK CLI sets that from your AWS configuration). Adding `prod` later is another entry in that map.

The CloudFormation stack name is `ConnectPlatform-<stage>`, for example `ConnectPlatform-sandbox`.

## Deploy

```bash
npx cdk deploy -c stage=sandbox
```

Do not synth or deploy without `-c stage=<stage>`.

## Feature apps

There are no CloudFormation exports. Read the instance from SSM with `StringParameter.valueForStringParameter`:

```typescript
import { StringParameter } from 'aws-cdk-lib/aws-ssm';

const instanceArn = StringParameter.valueForStringParameter(
  this,
  '/connect/sandbox/instance-arn',
);

const instanceId = StringParameter.valueForStringParameter(
  this,
  '/connect/sandbox/instance-id',
);
```

Parameters:

- `/connect/<stage>/instance-arn`
- `/connect/<stage>/instance-id`
