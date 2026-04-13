/**
 * Auth Stack - Cognito User Pool + OAuth2CredentialProvider
 *
 * Provides OAuth2 authentication for:
 * - Gateway inbound (CUSTOM_JWT): Orchestrator forwards user JWT to Gateway
 * - Gateway outbound (OAUTH): Gateway obtains token to call MCP Runtimes
 *
 * Demo users (alice, bob, charlie) are created for testing purposes.
 */
import * as cdk from 'aws-cdk-lib'
import * as cognito from 'aws-cdk-lib/aws-cognito'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as lambda_ from 'aws-cdk-lib/aws-lambda'
import * as ssm from 'aws-cdk-lib/aws-ssm'
import { Construct } from 'constructs'

export interface AuthStackProps extends cdk.StackProps {
  projectName: string
  environment: string
}

export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool
  public readonly userPoolDomain: cognito.UserPoolDomain
  public readonly appClient: cognito.UserPoolClient
  public readonly resourceServer: cognito.UserPoolResourceServer
  public readonly userClient: cognito.UserPoolClient
  public readonly credentialProviderArn: string
  public readonly discoveryUrl: string
  public readonly scope: string

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props)

    const { projectName, environment } = props

    // ============================================================
    // Cognito User Pool
    // ============================================================

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `${projectName}-gateway-auth`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      selfSignUpEnabled: false,
      signInAliases: { username: true, email: true },
      autoVerify: { email: true },
      // Uses Cognito default password policy (min 8 chars, requires mixed case + digits + symbols).
      // TODO: For production, consider increasing minLength or enabling advanced password options.
    })

    // Pre Token Generation trigger — injects agentcore/invoke scope into
    // access tokens issued via USER_PASSWORD_AUTH.  Without this, only OAuth
    // flows (authorization_code, client_credentials) include custom scopes.
    const preTokenFn = new lambda_.Function(this, 'PreTokenGenerationFn', {
      functionName: `${projectName}-pre-token-generation`,
      runtime: lambda_.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda_.Code.fromInline(`
exports.handler = async (event) => {
  // V2 trigger: add agentcore/invoke scope to access token
  event.response = {
    claimsAndScopeOverrideDetails: {
      accessTokenGeneration: {
        scopesToAdd: ['agentcore/invoke'],
      },
    },
  };
  return event;
};
      `),
      timeout: cdk.Duration.seconds(5),
      memorySize: 128,
    })

    this.userPool.addTrigger(
      cognito.UserPoolOperation.PRE_TOKEN_GENERATION_CONFIG,
      preTokenFn,
      cognito.LambdaVersion.V2_0,
    )

    // Domain for OAuth2 token endpoint
    this.userPoolDomain = this.userPool.addDomain('Domain', {
      cognitoDomain: {
        domainPrefix: `${projectName}-${this.account}`,
      },
    })

    // Resource Server with scope for machine-to-machine auth
    this.resourceServer = this.userPool.addResourceServer('ResourceServer', {
      identifier: 'agentcore',
      scopes: [
        { scopeName: 'invoke', scopeDescription: 'Invoke MCP Runtime agents' },
      ],
    })

    this.scope = 'agentcore/invoke'

    // App Client for Gateway outbound auth (client_credentials grant)
    this.appClient = this.userPool.addClient('GatewayClient', {
      userPoolClientName: `${projectName}-gateway-client`,
      generateSecret: true,
      oAuth: {
        flows: { clientCredentials: true },
        scopes: [
          cognito.OAuthScope.custom(this.scope),
        ],
      },
      authFlows: {},
    })
    this.appClient.node.addDependency(this.resourceServer)

    // User-facing App Client (for user login — no client secret)
    this.userClient = this.userPool.addClient('UserClient', {
      userPoolClientName: `${projectName}-user-client`,
      generateSecret: false,
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      oAuth: {
        flows: { implicitCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.PROFILE, cognito.OAuthScope.custom(this.scope)],
        callbackUrls: ['http://localhost:3000'],
      },
    })
    this.userClient.node.addDependency(this.resourceServer)

    // OIDC Discovery URL for JWT validation
    this.discoveryUrl = `https://cognito-idp.${this.region}.amazonaws.com/${this.userPool.userPoolId}/.well-known/openid-configuration`

    // ============================================================
    // Auth Setup Lambda (Custom Resource)
    // Handles: OAuth2CredentialProvider + Demo Users
    // ============================================================

    const authSetupFn = new lambda_.Function(this, 'AuthSetupFunction', {
      runtime: lambda_.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
      code: lambda_.Code.fromInline(`
const https = require('https');
const url = require('url');

exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event));
  const props = event.ResourceProperties;
  const region = props.Region;

  try {
    if (event.RequestType === 'Create' || event.RequestType === 'Update') {
      // --- OAuth2 Credential Provider ---
      const { BedrockAgentCoreControlClient, CreateOauth2CredentialProviderCommand, DeleteOauth2CredentialProviderCommand } =
        require('@aws-sdk/client-bedrock-agentcore-control');
      const agentcoreClient = new BedrockAgentCoreControlClient({ region });

      if (event.RequestType === 'Update') {
        try { await agentcoreClient.send(new DeleteOauth2CredentialProviderCommand({ name: props.ProviderName })); }
        catch (e) { console.log('Delete on update (ignoring):', e.message); }
      }

      const { CognitoIdentityProviderClient, DescribeUserPoolClientCommand,
              AdminCreateUserCommand, AdminSetUserPasswordCommand, AdminDeleteUserCommand } =
        require('@aws-sdk/client-cognito-identity-provider');
      const cognitoClient = new CognitoIdentityProviderClient({ region });

      // Get client secret for credential provider
      const descResp = await cognitoClient.send(new DescribeUserPoolClientCommand({
        UserPoolId: props.UserPoolId, ClientId: props.ClientId,
      }));
      const clientSecret = descResp.UserPoolClient.ClientSecret;

      const resp = await agentcoreClient.send(new CreateOauth2CredentialProviderCommand({
        name: props.ProviderName,
        credentialProviderVendor: 'CustomOauth2',
        oauth2ProviderConfigInput: {
          customOauth2ProviderConfig: {
            clientId: props.ClientId,
            clientSecret: clientSecret,
            oauthDiscovery: {
              discoveryUrl: props.DiscoveryUrl,
            },
          },
        },
      }));
      console.log('CredentialProvider created:', resp.credentialProviderArn);

      // --- Demo Users ---
      const testUsers = JSON.parse(props.TestUsers || '[]');
      for (const user of testUsers) {
        try {
          await cognitoClient.send(new AdminCreateUserCommand({
            UserPoolId: props.UserPoolId,
            Username: user,
            TemporaryPassword: 'TempPass123!',
            MessageAction: 'SUPPRESS',
            UserAttributes: [
              { Name: 'email', Value: user + '@example.com' },
              { Name: 'email_verified', Value: 'true' },
            ],
          }));
          await cognitoClient.send(new AdminSetUserPasswordCommand({
            UserPoolId: props.UserPoolId,
            Username: user,
            Password: props.TestPassword,
            Permanent: true,
          }));
          console.log('Demo user created:', user);
        } catch (e) {
          if (e.name === 'UsernameExistsException') {
            console.log('Demo user already exists:', user);
          } else { throw e; }
        }
      }

      // --- Workload Identity (for RBAC on-behalf-of flow) ---
      const { CreateWorkloadIdentityCommand, DeleteWorkloadIdentityCommand } =
        require('@aws-sdk/client-bedrock-agentcore-control');
      const workloadIdentityName = props.WorkloadIdentityName;
      let workloadIdentityArn = '';
      try {
        if (event.RequestType === 'Update') {
          try { await agentcoreClient.send(new DeleteWorkloadIdentityCommand({ name: workloadIdentityName })); }
          catch (e) { console.log('Delete workload identity on update (ignoring):', e.message); }
        }
        const wiResp = await agentcoreClient.send(new CreateWorkloadIdentityCommand({
          name: workloadIdentityName,
        }));
        workloadIdentityArn = wiResp.workloadIdentityArn || '';
        console.log('WorkloadIdentity created:', workloadIdentityName, workloadIdentityArn);
      } catch (e) {
        if (e.name === 'ConflictException' || e.name === 'ResourceAlreadyExistsException') {
          console.log('WorkloadIdentity already exists:', workloadIdentityName);
        } else {
          console.log('WorkloadIdentity creation warning:', e.message);
        }
      }

      return await sendResponse(event, 'SUCCESS', {
        CredentialProviderArn: resp.credentialProviderArn,
        WorkloadIdentityName: workloadIdentityName,
      });
    }

    if (event.RequestType === 'Delete') {
      // Delete credential provider
      try {
        const { BedrockAgentCoreControlClient, DeleteOauth2CredentialProviderCommand } =
          require('@aws-sdk/client-bedrock-agentcore-control');
        const agentcoreClient = new BedrockAgentCoreControlClient({ region });
        await agentcoreClient.send(new DeleteOauth2CredentialProviderCommand({ name: props.ProviderName }));
      } catch (e) { console.log('Delete credential provider (ignoring):', e.message); }

      // Delete workload identity
      try {
        const { BedrockAgentCoreControlClient: WIClient, DeleteWorkloadIdentityCommand } =
          require('@aws-sdk/client-bedrock-agentcore-control');
        const wiClient = new WIClient({ region });
        await wiClient.send(new DeleteWorkloadIdentityCommand({ name: props.WorkloadIdentityName }));
        console.log('WorkloadIdentity deleted:', props.WorkloadIdentityName);
      } catch (e) { console.log('Delete workload identity (ignoring):', e.message); }

      // Delete demo users
      try {
        const { CognitoIdentityProviderClient, AdminDeleteUserCommand } =
          require('@aws-sdk/client-cognito-identity-provider');
        const cognitoClient = new CognitoIdentityProviderClient({ region });
        const testUsers = JSON.parse(props.TestUsers || '[]');
        for (const user of testUsers) {
          try {
            await cognitoClient.send(new AdminDeleteUserCommand({
              UserPoolId: props.UserPoolId, Username: user,
            }));
            console.log('Demo user deleted:', user);
          } catch (e) { console.log('Delete user (ignoring):', user, e.message); }
        }
      } catch (e) { console.log('Delete users (ignoring):', e.message); }

      return await sendResponse(event, 'SUCCESS', {});
    }
  } catch (error) {
    console.error('Error:', error);
    return await sendResponse(event, 'FAILED', {}, error.message);
  }
};

async function sendResponse(event, status, data, reason) {
  const body = JSON.stringify({
    Status: status, Reason: reason || '',
    PhysicalResourceId: event.PhysicalResourceId || event.RequestId,
    StackId: event.StackId, RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId, Data: data,
  });
  const parsed = url.parse(event.ResponseURL);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: parsed.hostname, port: 443, path: parsed.path, method: 'PUT',
      headers: { 'Content-Type': '', 'Content-Length': body.length },
    }, () => resolve(data));
    req.on('error', reject); req.write(body); req.end();
  });
}
      `),
    })

    authSetupFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock-agentcore:CreateOauth2CredentialProvider',
          'bedrock-agentcore:DeleteOauth2CredentialProvider',
          'bedrock-agentcore:GetOauth2CredentialProvider',
          'bedrock-agentcore:CreateTokenVault',
          'bedrock-agentcore:GetTokenVault',
          'bedrock-agentcore:CreateWorkloadIdentity',
          'bedrock-agentcore:DeleteWorkloadIdentity',
          'bedrock-agentcore:GetWorkloadIdentity',
        ],
        // AgentCore credential provider ARNs are not known at deploy time
        resources: ['*'],
      })
    )

    authSetupFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'secretsmanager:CreateSecret',
          'secretsmanager:DeleteSecret',
          'secretsmanager:PutSecretValue',
        ],
        // AgentCore creates secrets with the prefix 'bedrock-agentcore-identity'
        resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:bedrock-agentcore-identity*`],
      })
    )

    authSetupFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'cognito-idp:DescribeUserPoolClient',
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminDeleteUser',
          'cognito-idp:AdminSetUserPassword',
        ],
        resources: [this.userPool.userPoolArn],
      })
    )

    const demoUsers = ['alice', 'bob', 'charlie']

    const credProvider = new cdk.CustomResource(this, 'AuthSetup', {
      serviceToken: authSetupFn.functionArn,
      properties: {
        ProviderName: `${projectName}-cognito-provider`,
        WorkloadIdentityName: `${projectName}-workload-identity`,
        ClientId: this.appClient.userPoolClientId,
        UserPoolId: this.userPool.userPoolId,
        DiscoveryUrl: this.discoveryUrl,
        TestUsers: JSON.stringify(demoUsers),
        TestPassword: process.env.DEMO_PASSWORD || 'Password123!',
        Region: this.region,
      },
    })

    this.credentialProviderArn = credProvider.getAttString('CredentialProviderArn')

    // ============================================================
    // SSM Parameters (consumed by other stacks)
    // ============================================================

    new ssm.StringParameter(this, 'CredentialProviderArnParam', {
      parameterName: `/${projectName}/${environment}/auth/credential-provider-arn`,
      stringValue: this.credentialProviderArn,
      tier: ssm.ParameterTier.STANDARD,
    })

    new ssm.StringParameter(this, 'UserPoolIdParam', {
      parameterName: `/${projectName}/${environment}/auth/user-pool-id`,
      stringValue: this.userPool.userPoolId,
      tier: ssm.ParameterTier.STANDARD,
    })

    new ssm.StringParameter(this, 'UserClientIdParam', {
      parameterName: `/${projectName}/${environment}/auth/user-client-id`,
      stringValue: this.userClient.userPoolClientId,
      tier: ssm.ParameterTier.STANDARD,
    })

    new ssm.StringParameter(this, 'AppClientIdParam', {
      parameterName: `/${projectName}/${environment}/auth/app-client-id`,
      stringValue: this.appClient.userPoolClientId,
      tier: ssm.ParameterTier.STANDARD,
    })

    new ssm.StringParameter(this, 'DiscoveryUrlParam', {
      parameterName: `/${projectName}/${environment}/auth/discovery-url`,
      stringValue: this.discoveryUrl,
      tier: ssm.ParameterTier.STANDARD,
    })

    new ssm.StringParameter(this, 'OAuthScopeParam', {
      parameterName: `/${projectName}/${environment}/auth/oauth-scope`,
      stringValue: this.scope,
      tier: ssm.ParameterTier.STANDARD,
    })

    new ssm.StringParameter(this, 'WorkloadIdentityNameParam', {
      parameterName: `/${projectName}/${environment}/auth/workload-identity-name`,
      stringValue: `${projectName}-workload-identity`,
      tier: ssm.ParameterTier.STANDARD,
    })

    // ============================================================
    // Outputs
    // ============================================================

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
    })

    new cdk.CfnOutput(this, 'GatewayClientId', {
      value: this.appClient.userPoolClientId,
      description: 'App Client for Gateway outbound OAuth (client_credentials)',
    })

    new cdk.CfnOutput(this, 'UserClientId', {
      value: this.userClient.userPoolClientId,
      description: 'App Client for user login',
    })

    new cdk.CfnOutput(this, 'CredentialProviderArnOutput', {
      value: this.credentialProviderArn,
      description: 'OAuth2CredentialProvider ARN for Gateway targets',
    })

    new cdk.CfnOutput(this, 'DiscoveryUrl', {
      value: this.discoveryUrl,
      description: 'OIDC Discovery URL for JWT validation',
    })

    new cdk.CfnOutput(this, 'DemoUsers', {
      value: 'alice, bob, charlie',
      description: 'Demo usernames (see README for login instructions)',
    })
  }
}
