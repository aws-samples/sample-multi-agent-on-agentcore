/**
 * Component Runtime Stack - Reusable stack for sub-agent Runtimes
 * Instantiated 5 times: HR, IT Support, Finance, Productivity, Knowledge
 *
 * Each sub-agent is deployed as an AgentCore Runtime (MCP protocol).
 * The Gateway connects to Runtimes via mcpServer targets.
 *
 * Auth config (discoveryUrl, allowedClients) is read from SSM — no cross-stack refs.
 */
import * as cdk from 'aws-cdk-lib'
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore'
import * as ecr from 'aws-cdk-lib/aws-ecr'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as ssm from 'aws-cdk-lib/aws-ssm'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment'
import * as codebuild from 'aws-cdk-lib/aws-codebuild'
import * as cr from 'aws-cdk-lib/custom-resources'
import * as lambda_ from 'aws-cdk-lib/aws-lambda'
import { Construct } from 'constructs'

export interface ComponentRuntimeStackProps extends cdk.StackProps {
  projectName: string
  environment: string
  componentName: string // 'hr' | 'it-support' | 'finance' | 'productivity' | 'knowledge'
  sourcePath: string // relative path to components parent (contains shared/ and component dirs)
  protocol?: string // default: 'MCP'
}

export class ComponentRuntimeStack extends cdk.Stack {
  public readonly runtime: agentcore.CfnRuntime
  public readonly runtimeArn: string

  constructor(scope: Construct, id: string, props: ComponentRuntimeStackProps) {
    super(scope, id, props)

    const { projectName, environment, componentName, sourcePath } = props
    const fullName = `${projectName}-${componentName}`

    // Read auth config from SSM (written by auth-stack)
    const discoveryUrl = ssm.StringParameter.valueForStringParameter(
      this, `/${projectName}/${environment}/auth/discovery-url`)
    const appClientId = ssm.StringParameter.valueForStringParameter(
      this, `/${projectName}/${environment}/auth/app-client-id`)

    // Read data config from SSM (written by data-stack)
    const userTableName = ssm.StringParameter.valueForStringParameter(
      this, `/${projectName}/${environment}/data/user-table-name`)
    const globalTableName = ssm.StringParameter.valueForStringParameter(
      this, `/${projectName}/${environment}/data/global-table-name`)
    const globalTableArn = ssm.StringParameter.valueForStringParameter(
      this, `/${projectName}/${environment}/data/global-table-arn`)

    // ECR Repository
    const repository = new ecr.Repository(this, 'Repository', {
      repositoryName: `${fullName}-mcp`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
      imageScanOnPush: true,
      lifecycleRules: [{ maxImageCount: 10 }],
    })

    // Execution Role for AgentCore Runtime
    const executionRole = new iam.Role(this, 'ExecutionRole', {
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
      description: `Execution role for ${componentName} Runtime`,
    })

    // ECR permissions
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ecr:BatchGetImage', 'ecr:GetDownloadUrlForLayer'],
        resources: [`arn:aws:ecr:${this.region}:${this.account}:repository/*`],
      })
    )

    executionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ecr:GetAuthorizationToken'],
        resources: ['*'], // ecr:GetAuthorizationToken requires '*' resource
      })
    )

    // CloudWatch Logs
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'logs:DescribeLogStreams',
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:PutLogEvents',
          'logs:DescribeLogGroups',
        ],
        resources: [
          `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/bedrock-agentcore/runtimes/*`,
          `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/bedrock-agentcore/runtimes/*:log-stream:*`,
          `arn:aws:logs:${this.region}:${this.account}:log-group:*`,
        ],
      })
    )

    // X-Ray Tracing (all X-Ray actions require '*' resource)
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'xray:PutTraceSegments',
          'xray:PutTelemetryRecords',
          'xray:GetSamplingRules',
          'xray:GetSamplingTargets',
        ],
        resources: ['*'],
      })
    )

    // CloudWatch Metrics
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
        conditions: {
          StringEquals: { 'cloudwatch:namespace': 'bedrock-agentcore' },
        },
      })
    )

    // Bedrock Model Access (for internal Strands Agent)
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'BedrockModelInvocation',
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock:InvokeModel',
          'bedrock:InvokeModelWithResponseStream',
          'bedrock:Converse',
          'bedrock:ConverseStream',
        ],
        resources: [
          'arn:aws:bedrock:*::foundation-model/*',
          `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/*`,
          `arn:aws:bedrock:${this.region}:${this.account}:*`,
        ],
      })
    )

    // DynamoDB: Global table read access for Knowledge agent (no RBAC needed)
    // Per-user table access is handled via scoped credentials injected by the interceptor
    if (componentName === 'knowledge') {
      executionRole.addToPolicy(
        new iam.PolicyStatement({
          sid: 'GlobalTableRead',
          effect: iam.Effect.ALLOW,
          actions: [
            'dynamodb:GetItem',
            'dynamodb:Query',
            'dynamodb:Scan',
          ],
          resources: [globalTableArn],
        })
      )
    }

    // S3 Source Bucket for CodeBuild
    const bucketSuffix = `-src-${this.account}-${this.region}`
    const bucketPrefix = fullName.length + bucketSuffix.length > 63
      ? fullName.substring(0, 63 - bucketSuffix.length)
      : fullName
    const sourceBucket = new s3.Bucket(this, 'SourceBucket', {
      bucketName: `${bucketPrefix}${bucketSuffix}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [{ expiration: cdk.Duration.days(7) }],
    })

    // CodeBuild Role
    const codeBuildRole = new iam.Role(this, 'CodeBuildRole', {
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
    })

    codeBuildRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ecr:GetAuthorizationToken'],
        resources: ['*'],
      })
    )

    codeBuildRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'ecr:BatchCheckLayerAvailability',
          'ecr:BatchGetImage',
          'ecr:GetDownloadUrlForLayer',
          'ecr:PutImage',
          'ecr:InitiateLayerUpload',
          'ecr:UploadLayerPart',
          'ecr:CompleteLayerUpload',
        ],
        resources: [
          `arn:aws:ecr:${this.region}:${this.account}:repository/${repository.repositoryName}`,
        ],
      })
    )

    codeBuildRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: [
          `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/codebuild/${fullName}-*`,
        ],
      })
    )

    codeBuildRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket'],
        resources: [sourceBucket.bucketArn, `${sourceBucket.bucketArn}/*`],
      })
    )

    // CodeBuild Project
    const buildProject = new codebuild.Project(this, 'BuildProject', {
      projectName: `${fullName}-builder`,
      description: `Builds ARM64 container image for ${componentName} Runtime`,
      role: codeBuildRole,
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_ARM_3,
        computeType: codebuild.ComputeType.SMALL,
        privileged: true,
      },
      source: codebuild.Source.s3({
        bucket: sourceBucket,
        path: 'source/',
      }),
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          pre_build: {
            commands: [
              'echo Logging in to Amazon ECR...',
              `aws ecr get-login-password --region ${this.region} | docker login --username AWS --password-stdin ${this.account}.dkr.ecr.${this.region}.amazonaws.com`,
            ],
          },
          build: {
            commands: [
              'echo Building Docker image for ARM64...',
              `docker build --platform linux/arm64 -f ${componentName}/Dockerfile -t agent:latest .`,
              `docker tag agent:latest ${repository.repositoryUri}:latest`,
            ],
          },
          post_build: {
            commands: [
              `docker push ${repository.repositoryUri}:latest`,
              'echo Build completed successfully',
            ],
          },
        },
      }),
    })

    // Upload source to S3
    const sourceUpload = new s3deploy.BucketDeployment(this, 'SourceUpload', {
      sources: [
        s3deploy.Source.asset(sourcePath, {
          exclude: ['__pycache__/**', '*.pyc', '.DS_Store'],
        }),
      ],
      destinationBucket: sourceBucket,
      destinationKeyPrefix: 'source/',
      prune: true,
      retainOnDelete: false,
    })

    // Trigger CodeBuild
    const buildTimestamp = new Date().toISOString()
    const buildTrigger = new cr.AwsCustomResource(this, 'TriggerCodeBuild', {
      onCreate: {
        service: 'CodeBuild',
        action: 'startBuild',
        parameters: { projectName: buildProject.projectName },
        physicalResourceId: cr.PhysicalResourceId.of(`build-${buildTimestamp}`),
      },
      onUpdate: {
        service: 'CodeBuild',
        action: 'startBuild',
        parameters: { projectName: buildProject.projectName },
        physicalResourceId: cr.PhysicalResourceId.of(`build-${buildTimestamp}`),
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['codebuild:StartBuild', 'codebuild:BatchGetBuilds'],
          resources: [buildProject.projectArn],
        }),
      ]),
      timeout: cdk.Duration.minutes(5),
    })
    buildTrigger.node.addDependency(sourceUpload)

    // Wait for Build to Complete
    const buildWaiterFunction = new lambda_.Function(this, 'BuildWaiterFunction', {
      runtime: lambda_.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda_.Code.fromInline(`
const { CodeBuildClient, BatchGetBuildsCommand } = require('@aws-sdk/client-codebuild');

exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event));
  if (event.RequestType === 'Delete') {
    return sendResponse(event, 'SUCCESS', { Status: 'DELETED' });
  }

  const buildId = event.ResourceProperties.BuildId;
  const maxWaitMinutes = 14;
  const pollIntervalSeconds = 30;
  const client = new CodeBuildClient({});
  const startTime = Date.now();
  const maxWaitMs = maxWaitMinutes * 60 * 1000;

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const response = await client.send(new BatchGetBuildsCommand({ ids: [buildId] }));
      const build = response.builds[0];
      const status = build.buildStatus;
      console.log('Build status:', status);

      if (status === 'SUCCEEDED') {
        return await sendResponse(event, 'SUCCESS', { Status: 'SUCCEEDED' });
      } else if (['FAILED', 'FAULT', 'TIMED_OUT', 'STOPPED'].includes(status)) {
        return await sendResponse(event, 'FAILED', {}, 'Build failed: ' + status);
      }
      await new Promise(resolve => setTimeout(resolve, pollIntervalSeconds * 1000));
    } catch (error) {
      console.error('Error:', error);
      return await sendResponse(event, 'FAILED', {}, error.message);
    }
  }
  return await sendResponse(event, 'FAILED', {}, 'Build timeout');
};

async function sendResponse(event, status, data, reason) {
  const responseBody = JSON.stringify({
    Status: status,
    Reason: reason || 'See CloudWatch Log Stream',
    PhysicalResourceId: event.PhysicalResourceId || event.RequestId,
    StackId: event.StackId, RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId, Data: data
  });
  const https = require('https');
  const url = require('url');
  const parsedUrl = url.parse(event.ResponseURL);
  return new Promise((resolve, reject) => {
    const options = {
      hostname: parsedUrl.hostname, port: 443, path: parsedUrl.path,
      method: 'PUT', headers: { 'Content-Type': '', 'Content-Length': responseBody.length }
    };
    const request = https.request(options, (response) => { resolve(data); });
    request.on('error', (error) => { reject(error); });
    request.write(responseBody);
    request.end();
  });
}
      `),
      timeout: cdk.Duration.minutes(15),
      memorySize: 256,
    })

    buildWaiterFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['codebuild:BatchGetBuilds'],
        resources: [buildProject.projectArn],
      })
    )

    const buildWaiter = new cdk.CustomResource(this, 'BuildWaiter', {
      serviceToken: buildWaiterFunction.functionArn,
      properties: {
        BuildId: buildTrigger.getResponseField('build.id'),
      },
    })
    buildWaiter.node.addDependency(buildTrigger)

    // AgentCore Runtime
    const runtimeBase = fullName.replace(/-/g, '_')
    const fullRuntimeName = runtimeBase + '_mcp_runtime'
    const runtimeName = fullRuntimeName.length <= 48
      ? fullRuntimeName
      : runtimeBase.substring(0, 48 - '_mcp_rt'.length) + '_mcp_rt'
    this.runtime = new agentcore.CfnRuntime(this, 'Runtime', {
      agentRuntimeName: runtimeName,
      description: `${componentName.toUpperCase()} sub-agent Runtime (${props.protocol || 'MCP'})`,
      roleArn: executionRole.roleArn,
      agentRuntimeArtifact: {
        containerConfiguration: {
          containerUri: `${repository.repositoryUri}:latest`,
        },
      },
      // TODO: For production, use VPC network mode with private subnets
      networkConfiguration: {
        networkMode: 'PUBLIC',
      },
      protocolConfiguration: props.protocol || 'MCP',

      // JWT inbound auth — values resolved at deploy time from SSM
      authorizerConfiguration: {
        customJwtAuthorizer: {
          discoveryUrl,
          allowedClients: [appClientId],
        },
      },

      environmentVariables: {
        LOG_LEVEL: 'INFO',
        COMPONENT_NAME: componentName,
        AWS_REGION: this.region,
        USER_DATA_TABLE: userTableName,
        GLOBAL_DATA_TABLE: globalTableName,
        DEPLOY_TIMESTAMP: new Date().toISOString(),
      },
      tags: {
        Environment: environment,
        Application: projectName,
        Component: componentName,
      },
    })

    this.runtime.node.addDependency(executionRole)
    this.runtime.node.addDependency(buildWaiter)
    this.runtimeArn = this.runtime.attrAgentRuntimeArn

    // Build Runtime invocation URL
    const encodedArn = cdk.Fn.join('', [
      'arn%3Aaws%3Abedrock-agentcore%3A',
      this.region,
      '%3A',
      this.account,
      '%3Aruntime%2F',
      this.runtime.attrAgentRuntimeId,
    ])

    const runtimeInvocationUrl = cdk.Fn.join('', [
      'https://bedrock-agentcore.',
      this.region,
      '.amazonaws.com/runtimes/',
      encodedArn,
      '/invocations?qualifier=DEFAULT',
    ])

    // SSM Parameters (consumed by gateway-stack)
    new ssm.StringParameter(this, 'RuntimeArnParameter', {
      parameterName: `/${projectName}/${environment}/components/${componentName}/runtime-arn`,
      stringValue: this.runtime.attrAgentRuntimeArn,
      description: `${componentName.toUpperCase()} Runtime ARN`,
      tier: ssm.ParameterTier.STANDARD,
    })

    new ssm.StringParameter(this, 'RuntimeUrlParameter', {
      parameterName: `/${projectName}/${environment}/components/${componentName}/runtime-url`,
      stringValue: runtimeInvocationUrl,
      description: `${componentName.toUpperCase()} Runtime Invocation URL`,
      tier: ssm.ParameterTier.STANDARD,
    })

    // Outputs
    new cdk.CfnOutput(this, 'RuntimeArn', {
      value: this.runtime.attrAgentRuntimeArn,
      description: `${componentName.toUpperCase()} Runtime ARN`,
    })

    new cdk.CfnOutput(this, 'RuntimeId', {
      value: this.runtime.attrAgentRuntimeId,
      description: `${componentName.toUpperCase()} Runtime ID`,
    })

    new cdk.CfnOutput(this, 'RepositoryUri', {
      value: repository.repositoryUri,
      description: `${componentName.toUpperCase()} ECR Repository URI`,
    })
  }
}
