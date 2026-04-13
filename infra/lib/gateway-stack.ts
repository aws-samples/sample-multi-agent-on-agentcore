/**
 * Gateway Stack for AgentCore Gateway
 * Creates Gateway with MCP protocol, CUSTOM_JWT inbound auth, and 5 mcpServer targets:
 * HR, IT Support, Finance, Productivity, Knowledge
 *
 * All external values (auth config, runtime URLs) are read from SSM parameters
 * at deploy time — no cross-stack Fn::ImportValue dependencies.
 *
 * Targets use OAUTH credential provider (Cognito client_credentials).
 * User identity is propagated via body injection (interceptor Lambda injects
 * into JSON-RPC params.arguments; MCP server middleware strips before tool sees them).
 */
import * as cdk from 'aws-cdk-lib'
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as lambda_ from 'aws-cdk-lib/aws-lambda'
import * as ssm from 'aws-cdk-lib/aws-ssm'
import * as path from 'path'
import { Construct } from 'constructs'

export interface GatewayStackProps extends cdk.StackProps {
  projectName: string
  environment: string
}

export class GatewayStack extends cdk.Stack {
  public readonly gateway: agentcore.CfnGateway
  public readonly gatewayUrl: string

  constructor(scope: Construct, id: string, props: GatewayStackProps) {
    super(scope, id, props)

    const { projectName, environment } = props

    // ============================================================
    // Read all config from SSM (no cross-stack refs)
    // ============================================================

    const ssmVal = (paramPath: string) =>
      ssm.StringParameter.valueForStringParameter(this, `/${projectName}/${environment}/${paramPath}`)

    // Auth config (from auth-stack)
    const credentialProviderArn = ssmVal('auth/credential-provider-arn')
    const oauthScope = ssmVal('auth/oauth-scope')
    const discoveryUrl = ssmVal('auth/discovery-url')
    const appClientId = ssmVal('auth/app-client-id')
    const userClientId = ssmVal('auth/user-client-id')

    // Component runtime URLs (from component-runtime-stacks)
    const componentNames = ['hr', 'it-support', 'finance', 'productivity', 'knowledge']
    const runtimeUrls: Record<string, string> = {}
    for (const name of componentNames) {
      runtimeUrls[name] = ssmVal(`components/${name}/runtime-url`)
    }

    // Data config (from data-stack) — scoped role for RBAC credential injection
    const scopedRoleArn = ssmVal('data/scoped-role-arn')

    // Workload identity name (from auth-stack) — for AgentCore Identity token exchange
    const workloadIdentityName = ssmVal('auth/workload-identity-name')

    // ============================================================
    // Gateway IAM Role (created locally — no cross-stack dep)
    // ============================================================

    const gatewayRole = new iam.Role(this, 'GatewayRole', {
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
      description: 'IAM role for AgentCore Gateway',
    })

    // Invoke all Runtimes
    gatewayRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'InvokeRuntimes',
        effect: iam.Effect.ALLOW,
        actions: ['bedrock-agentcore:InvokeAgentRuntime'],
        resources: [`arn:aws:bedrock-agentcore:${this.region}:${this.account}:runtime/*`],
      })
    )

    // OAuth2 credential provider and token vault
    gatewayRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'UseOAuthCredentialProvider',
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock-agentcore:GetOauth2CredentialProvider',
          'bedrock-agentcore:GetOauth2AccessToken',
          'bedrock-agentcore:GetResourceOauth2Token',
          'bedrock-agentcore:GetTokenVault',
          'bedrock-agentcore:RetrieveToken',
        ],
        // Credential provider and token vault ARNs are not known at deploy time
        resources: ['*'],
      })
    )

    // Workload identity (M2M token exchange)
    gatewayRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'WorkloadIdentityAccess',
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock-agentcore:GetWorkloadAccessToken',
          'bedrock-agentcore:CreateWorkloadIdentity',
        ],
        // Workload identity ARNs are generated at runtime
        resources: ['*'],
      })
    )

    // Secrets Manager for client secret
    gatewayRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ReadClientSecret',
        effect: iam.Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:bedrock-agentcore-identity*`],
      })
    )

    // ============================================================
    // Interceptor Lambda
    // ============================================================

    const interceptorFunction = new lambda_.Function(this, 'GatewayInterceptor', {
      functionName: `${projectName}-gateway-interceptor`,
      runtime: lambda_.Runtime.PYTHON_3_13,
      handler: 'index.lambda_handler',
      code: lambda_.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'gateway-interceptor')),
      timeout: cdk.Duration.seconds(15),
      memorySize: 256,
      environment: {
        SCOPED_ROLE_ARN: scopedRoleArn,
        WORKLOAD_IDENTITY_NAME: workloadIdentityName,
      },
    })
    interceptorFunction.grantInvoke(new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'))

    // Allow interceptor Lambda to assume the scoped role with session tags
    interceptorFunction.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'AssumeUserScopedRole',
        effect: iam.Effect.ALLOW,
        actions: ['sts:AssumeRole', 'sts:TagSession'],
        resources: [scopedRoleArn],
      })
    )

    // Allow interceptor Lambda to exchange user JWT via AgentCore Identity
    interceptorFunction.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'AgentCoreIdentityTokenExchange',
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock-agentcore:GetWorkloadAccessToken',
          'bedrock-agentcore:GetWorkloadIdentity',
        ],
        resources: ['*'],
      })
    )

    gatewayRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'InvokeInterceptorLambda',
        effect: iam.Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [interceptorFunction.functionArn],
      })
    )

    // ============================================================
    // AgentCore Gateway (CUSTOM_JWT inbound auth)
    // ============================================================

    this.gateway = new agentcore.CfnGateway(this, 'MCPGateway', {
      name: `${projectName}-mcp-gateway`,
      description: 'MCP Gateway for HR, IT Support, Finance, Productivity, and Knowledge sub-agents',
      roleArn: gatewayRole.roleArn,
      authorizerType: 'CUSTOM_JWT',
      authorizerConfiguration: {
        customJwtAuthorizer: {
          discoveryUrl,
          allowedClients: [appClientId, userClientId],
        },
      },
      interceptorConfigurations: [{
        interceptionPoints: ['REQUEST'],
        interceptor: {
          lambda: {
            arn: interceptorFunction.functionArn,
          },
        },
        inputConfiguration: {
          passRequestHeaders: true,
        },
      }],
      protocolType: 'MCP',
      // NOTE: Only DEBUG is currently supported by AgentCore Gateway.
      // For production, monitor for additional supported values.
      exceptionLevel: 'DEBUG',
      protocolConfiguration: {
        mcp: {
          supportedVersions: ['2025-03-26', '2025-06-18'],
          searchType: 'HYBRID',
        },
      },
      tags: {
        Environment: environment,
        Application: projectName,
      },
    })

    this.gatewayUrl = this.gateway.attrGatewayUrl

    // ============================================================
    // Shared target configs
    // ============================================================

    const oauthCredentialConfig = {
      credentialProviderType: 'OAUTH',
      credentialProvider: {
        oauthCredentialProvider: {
          providerArn: credentialProviderArn,
          scopes: [oauthScope],
        },
      },
    }

    // ============================================================
    // Gateway Targets (5 mcpServer)
    // ============================================================

    new agentcore.CfnGatewayTarget(this, 'HRMcpTarget', {
      name: 'hr-mcp-server',
      gatewayIdentifier: this.gateway.attrGatewayIdentifier,
      description: 'HR sub-agent MCP server (employee profiles, PTO, performance reviews, open positions, onboarding)',
      credentialProviderConfigurations: [oauthCredentialConfig],
      targetConfiguration: {
        mcp: {
          mcpServer: {
            endpoint: runtimeUrls['hr'],
          },
        },
      },
    })

    new agentcore.CfnGatewayTarget(this, 'ITSupportMcpTarget', {
      name: 'it-support-mcp-server',
      gatewayIdentifier: this.gateway.attrGatewayIdentifier,
      description: 'IT Support sub-agent MCP server (tickets, software access, equipment, service status)',
      credentialProviderConfigurations: [oauthCredentialConfig],
      targetConfiguration: {
        mcp: {
          mcpServer: {
            endpoint: runtimeUrls['it-support'],
          },
        },
      },
    })

    new agentcore.CfnGatewayTarget(this, 'FinanceMcpTarget', {
      name: 'finance-mcp-server',
      gatewayIdentifier: this.gateway.attrGatewayIdentifier,
      description: 'Finance sub-agent MCP server (expenses, budgets, invoices, reimbursements)',
      credentialProviderConfigurations: [oauthCredentialConfig],
      targetConfiguration: {
        mcp: {
          mcpServer: {
            endpoint: runtimeUrls['finance'],
          },
        },
      },
    })

    new agentcore.CfnGatewayTarget(this, 'ProductivityMcpTarget', {
      name: 'productivity-mcp-server',
      gatewayIdentifier: this.gateway.attrGatewayIdentifier,
      description: 'Productivity sub-agent MCP server (calendar, documents, meeting notes)',
      credentialProviderConfigurations: [oauthCredentialConfig],
      targetConfiguration: {
        mcp: {
          mcpServer: {
            endpoint: runtimeUrls['productivity'],
          },
        },
      },
    })

    new agentcore.CfnGatewayTarget(this, 'KnowledgeMcpTarget', {
      name: 'knowledge-mcp-server',
      gatewayIdentifier: this.gateway.attrGatewayIdentifier,
      description: 'Knowledge sub-agent MCP server (company policies, employee handbook, office info)',
      credentialProviderConfigurations: [oauthCredentialConfig],
      targetConfiguration: {
        mcp: {
          mcpServer: {
            endpoint: runtimeUrls['knowledge'],
          },
        },
      },
    })

    // ============================================================
    // SSM Parameters
    // ============================================================

    new ssm.StringParameter(this, 'GatewayUrlParam', {
      parameterName: `/${projectName}/${environment}/mcp/gateway-url`,
      stringValue: this.gatewayUrl,
      description: 'AgentCore Gateway URL (CUSTOM_JWT authenticated)',
      tier: ssm.ParameterTier.STANDARD,
    })

    new ssm.StringParameter(this, 'GatewayArnParam', {
      parameterName: `/${projectName}/${environment}/mcp/gateway-arn`,
      stringValue: this.gateway.attrGatewayArn,
      tier: ssm.ParameterTier.STANDARD,
    })

    // ============================================================
    // Outputs
    // ============================================================

    new cdk.CfnOutput(this, 'GatewayUrl', {
      value: this.gatewayUrl,
      description: 'Gateway URL (requires CUSTOM_JWT authentication)',
    })

    new cdk.CfnOutput(this, 'GatewayArn', {
      value: this.gateway.attrGatewayArn,
    })

    new cdk.CfnOutput(this, 'GatewayId', {
      value: this.gateway.attrGatewayIdentifier,
    })

    new cdk.CfnOutput(this, 'TotalTargets', {
      value: '5',
      description: 'Total Gateway Targets: HR + IT Support + Finance + Productivity + Knowledge',
    })
  }
}
