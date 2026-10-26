# Connect platform

Long-lived Amazon Connect base stack. Other CDK apps deploy features onto the instance this stack creates.

The stack creates one Connect instance (`CONNECT_MANAGED`, inbound and outbound calls, contact flow logs, Contact Lens) and publishes its ARN and ID. Termination protection is on, and the instance is retained on stack delete.

Call recordings, chat transcripts, and scheduled reports go to one private S3 bucket (Block Public Access, SSE-S3, SSL-only, versioning off, retained). Recordings and transcripts expire after `storageRetentionDays` on the stage (`30` for sandbox); reports are kept. Contact trace records are not configured.

The stage's `phoneNumbers` list is claimed onto the instance (`sandbox` claims one US DID). The number is retained and is not associated with a contact flow.

One Amazon Q in Connect assistant (`AGENT`, name `chris-connect-<stage>-assistant`) is associated with the instance so feature apps share it. Encryption is the AWS owned key. The assistant is retained on stack delete; the association is deleted with the stack.

One Customer Profiles domain (`amazon-connect-<stage>-profiles`, default expiration 366 days, no data store or matching) is linked to the instance with a contact trace record integration (`ObjectTypeName` `CTR`, URI the instance ARN). The name has to start with `amazon-connect-`: `AmazonConnectServiceLinkedRolePolicy` grants `profile:*` only on `domains/amazon-connect-*`. The domain is replaced when that name changes, which deletes the previous domain and its profiles. The domain is deleted with the stack.

Connect allows one Customer Profiles domain per instance. That association is the Customer Profiles integration, not an `AWS::Connect::IntegrationAssociation`. CloudFormation replaces the integration by creating the new one before it deletes the old one. A custom resource calls `DeleteIntegration` for the previous domain (`chris-connect-<stage>-profiles`) and this instance before the new integration is created. `ResourceNotFoundException` is ignored, so a new environment still deploys. The integration's `UpdateReplacePolicy` is `Retain` and its `DeletionPolicy` is `Delete`, so CloudFormation does not call `DeleteIntegration` on the previous integration after the custom resource has already removed it. Deleting the stack still deletes the current integration.

Agent guidance for AWS work in this repo is in [.cursor/rules/aws.mdc](.cursor/rules/aws.mdc).

## Stages

Stage is required context and must be a key in `stages` (`lib/stages.ts`). `sandbox` is the only entry: account `945777367807`, region `CDK_DEFAULT_REGION` (the CDK CLI sets that from your AWS configuration), `storageRetentionDays: 30`, and `phoneNumbers: [{ countryCode: 'US', type: 'DID' }]`. Adding `prod` later is another entry in that map, with its own retention and phone number list.

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

const storageBucket = StringParameter.valueForStringParameter(
  this,
  '/connect/sandbox/storage-bucket',
);

const phoneNumberArn = StringParameter.valueForStringParameter(
  this,
  '/connect/sandbox/phone-number-arn',
);

const phoneNumber = StringParameter.valueForStringParameter(
  this,
  '/connect/sandbox/phone-number',
);

const assistantArn = StringParameter.valueForStringParameter(
  this,
  '/connect/sandbox/assistant-arn',
);

const assistantId = StringParameter.valueForStringParameter(
  this,
  '/connect/sandbox/assistant-id',
);

const profilesDomainName = StringParameter.valueForStringParameter(
  this,
  '/connect/sandbox/profiles-domain-name',
);
```

Parameters:

- `/connect/<stage>/instance-arn`
- `/connect/<stage>/instance-id`
- `/connect/<stage>/storage-bucket`
- `/connect/<stage>/phone-number-arn`
- `/connect/<stage>/phone-number` (E.164)
- `/connect/<stage>/assistant-arn`
- `/connect/<stage>/assistant-id`
- `/connect/<stage>/profiles-domain-name`
