/**
 * Orchestrator Runtime Stack
 * Deploys the Concierge Agent as AgentCore Runtime (HTTP protocol)
 * Includes AgentCore Memory for conversation history and user preferences
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

export interface RuntimeStackProps extends cdk.StackProps {
  projectName: string
  environment: string
}

export class RuntimeStack extends cdk.Stack {
  public readonly runtime: agentcore.CfnRuntime
  public readonly memory: agentcore.CfnMemory
  public readonly runtimeArn: string

  constructor(scope: Construct, id: string, props: RuntimeStackProps) {
    super(scope, id, props)

    const { projectName, environment } = props

    // Read gateway URL from SSM (written by gateway-stack)
    const gatewayUrl = ssm.StringParameter.valueForStringParameter(
      this, `/${projectName}/${environment}/mcp/gateway-url`)

    // Read registry config from SSM (written by registry-stack)
    const registryId = ssm.StringParameter.valueForStringParameter(
      this, `/${projectName}/${environment}/registry/registry-id`)


    // Memory Execution Role (created locally — no cross-stack dep)
    const memoryExecutionRole = new iam.Role(this, 'MemoryExecutionRole', {
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
      description: 'Execution role for AgentCore Memory to access Bedrock models',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'AmazonBedrockAgentCoreMemoryBedrockModelInferenceExecutionRolePolicy'
        ),
      ],
    })

    // ECR Repository
    const repository = new ecr.Repository(this, 'Repository', {
      repositoryName: `${projectName}-orchestrator`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
      imageScanOnPush: true,
      lifecycleRules: [{ maxImageCount: 10 }],
    })

    // Execution Role
    const executionRole = new iam.Role(this, 'ExecutionRole', {
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
      description: 'Execution role for Concierge Agent Runtime',
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

    // X-Ray (all X-Ray actions require '*' resource)
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

    // Bedrock Model Access
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
          `arn:aws:bedrock:${this.region}:${this.account}:*`,
        ],
      })
    )

    // SSM Parameter Store access
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/${projectName}/*`,
        ],
      })
    )

    // AgentCore Gateway Access
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'GatewayAccess',
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock-agentcore:InvokeGateway',
          'bedrock-agentcore:GetGateway',
          'bedrock-agentcore:ListGateways',
        ],
        resources: [
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:gateway/*`,
        ],
      })
    )

    // AgentCore Registry Access (search + list for agent discovery)
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'RegistryAccess',
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock-agentcore:SearchRegistryRecords',
          'bedrock-agentcore:GetRegistryRecord',
          'bedrock-agentcore:ListRegistryRecords',
        ],
        resources: [
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:registry/*`,
        ],
      })
    )

    // AgentCore Memory
    const memoryName = projectName.replace(/-/g, '_') + '_memory'
    this.memory = new agentcore.CfnMemory(this, 'Memory', {
      name: memoryName,
      description: 'Memory for user preferences and conversation context',
      memoryExecutionRoleArn: memoryExecutionRole.roleArn,
      eventExpiryDuration: 90,
      memoryStrategies: [
        {
          userPreferenceMemoryStrategy: {
            name: 'user_preference_extraction',
            description: 'Extracts and stores user preferences from conversations',
            namespaces: ['/strategies/{memoryStrategyId}/actors/{actorId}/preferences'],
          },
        },
        {
          semanticMemoryStrategy: {
            name: 'semantic_fact_extraction',
            description: 'Extracts semantic facts and learned information',
            namespaces: ['/strategies/{memoryStrategyId}/actors/{actorId}/facts'],
          },
        },
      ],
    })

    // Memory access permissions
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'MemoryAccess',
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock-agentcore:CreateEvent',
          'bedrock-agentcore:GetEvent',
          'bedrock-agentcore:DeleteEvent',
          'bedrock-agentcore:ListEvents',
          'bedrock-agentcore:GetMemoryRecord',
          'bedrock-agentcore:RetrieveMemoryRecords',
          'bedrock-agentcore:ListMemoryRecords',
          'bedrock-agentcore:DeleteMemoryRecord',
          'bedrock-agentcore:ListActors',
          'bedrock-agentcore:ListSessions',
        ],
        resources: [this.memory.attrMemoryArn],
      })
    )

    // S3 Source Bucket
    const sourceBucket = new s3.Bucket(this, 'SourceBucket', {
      bucketName: `${projectName}-orch-src-${this.account}-${this.region}`,
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
          `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/codebuild/${projectName}-*`,
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
      projectName: `${projectName}-orchestrator-builder`,
      description: 'Builds ARM64 container for Concierge Agent Runtime',
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
              `aws ecr get-login-password --region ${this.region} | docker login --username AWS --password-stdin ${this.account}.dkr.ecr.${this.region}.amazonaws.com`,
            ],
          },
          build: {
            commands: [
              'docker build --platform linux/arm64 -t agent:latest .',
              `docker tag agent:latest ${repository.repositoryUri}:latest`,
            ],
          },
          post_build: {
            commands: [
              `docker push ${repository.repositoryUri}:latest`,
            ],
          },
        },
      }),
    })

    // Upload source
    const sourceUpload = new s3deploy.BucketDeployment(this, 'SourceUpload', {
      sources: [
        s3deploy.Source.asset('../agents/orchestrator', {
          exclude: [
            'venv/**', '.venv/**', '__pycache__/**', '*.pyc',
            '.DS_Store', 'sessions/**',
          ],
        }),
      ],
      destinationBucket: sourceBucket,
      destinationKeyPrefix: 'source/',
      prune: false,
    })

    // Trigger build
    const buildTrigger = new cr.AwsCustomResource(this, 'TriggerCodeBuild', {
      onCreate: {
        service: 'CodeBuild',
        action: 'startBuild',
        parameters: { projectName: buildProject.projectName },
        physicalResourceId: cr.PhysicalResourceId.of(`build-${Date.now()}`),
      },
      onUpdate: {
        service: 'CodeBuild',
        action: 'startBuild',
        parameters: { projectName: buildProject.projectName },
        physicalResourceId: cr.PhysicalResourceId.of(`build-${Date.now()}`),
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['codebuild:StartBuild', 'codebuild:BatchGetBuilds'],
          resources: [buildProject.projectArn],
        }),
      ]),
    })
    buildTrigger.node.addDependency(sourceUpload)

    // Build waiter
    const buildWaiterFunction = new lambda_.Function(this, 'BuildWaiterFunction', {
      runtime: lambda_.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda_.Code.fromInline(`
const { CodeBuildClient, BatchGetBuildsCommand } = require('@aws-sdk/client-codebuild');
exports.handler = async (event) => {
  if (event.RequestType === 'Delete') return sendResponse(event, 'SUCCESS', {});
  const buildId = event.ResourceProperties.BuildId;
  const client = new CodeBuildClient({});
  const start = Date.now();
  while (Date.now() - start < 14 * 60 * 1000) {
    const r = await client.send(new BatchGetBuildsCommand({ ids: [buildId] }));
    const s = r.builds[0].buildStatus;
    if (s === 'SUCCEEDED') return sendResponse(event, 'SUCCESS', {});
    if (['FAILED','FAULT','TIMED_OUT','STOPPED'].includes(s)) return sendResponse(event, 'FAILED', {}, 'Build: ' + s);
    await new Promise(r => setTimeout(r, 30000));
  }
  return sendResponse(event, 'FAILED', {}, 'Timeout');
};
async function sendResponse(event, status, data, reason) {
  const body = JSON.stringify({ Status: status, Reason: reason || '', PhysicalResourceId: event.PhysicalResourceId || event.RequestId, StackId: event.StackId, RequestId: event.RequestId, LogicalResourceId: event.LogicalResourceId, Data: data });
  const https = require('https'), url = require('url'), p = url.parse(event.ResponseURL);
  return new Promise((res, rej) => { const r = https.request({ hostname: p.hostname, port: 443, path: p.path, method: 'PUT', headers: { 'Content-Type': '', 'Content-Length': body.length } }, () => res(data)); r.on('error', rej); r.write(body); r.end(); });
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
      properties: { BuildId: buildTrigger.getResponseField('build.id') },
    })
    buildWaiter.node.addDependency(buildTrigger)

    // AgentCore Runtime (HTTP protocol for orchestrator)
    const runtimeName = projectName.replace(/-/g, '_') + '_orchestrator_runtime'
    this.runtime = new agentcore.CfnRuntime(this, 'Runtime', {
      agentRuntimeName: runtimeName,
      description: 'Concierge Agent Runtime with Gateway MCP tools and Memory',
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
      protocolConfiguration: 'HTTP',
      environmentVariables: {
        LOG_LEVEL: 'INFO',
        AWS_REGION: this.region,
        PROJECT_NAME: projectName,
        ENVIRONMENT: environment,
        MEMORY_ID: this.memory.attrMemoryId,
        GATEWAY_URL: gatewayUrl,
        REGISTRY_ID: registryId,
        SEARCH_THRESHOLD: '10',
        USE_MEMORY_RETRIEVAL: 'true',
        BUILD_TIMESTAMP: new Date().toISOString(),
      },
      tags: {
        Environment: environment,
        Application: projectName,
      },
    })

    this.runtime.node.addDependency(executionRole)
    this.runtime.node.addDependency(buildWaiter)
    this.runtime.node.addDependency(this.memory)
    this.runtimeArn = this.runtime.attrAgentRuntimeArn

    // Cost allocation tags on the execution role for Bedrock cost tracking
    cdk.Tags.of(executionRole).add('CostCenter', 'orchestrator')
    cdk.Tags.of(executionRole).add('AgentComponent', 'orchestrator')
    cdk.Tags.of(executionRole).add('AgentRole', 'orchestrator')

    // SSM Parameters
    new ssm.StringParameter(this, 'RuntimeArnParam', {
      parameterName: `/${projectName}/${environment}/agentcore/runtime-arn`,
      stringValue: this.runtime.attrAgentRuntimeArn,
      tier: ssm.ParameterTier.STANDARD,
    })
    new ssm.StringParameter(this, 'MemoryIdParam', {
      parameterName: `/${projectName}/${environment}/agentcore/memory-id`,
      stringValue: this.memory.attrMemoryId,
      tier: ssm.ParameterTier.STANDARD,
    })

    // Outputs
    new cdk.CfnOutput(this, 'RuntimeArn', {
      value: this.runtime.attrAgentRuntimeArn,
    })
    new cdk.CfnOutput(this, 'MemoryId', {
      value: this.memory.attrMemoryId,
    })
    new cdk.CfnOutput(this, 'MemoryArn', {
      value: this.memory.attrMemoryArn,
    })
  }
}
