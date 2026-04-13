/**
 * Data Stack - DynamoDB tables + RBAC IAM role for per-user access control
 *
 * Creates:
 * - User data table (per-user, RBAC via IAM LeadingKeys condition)
 * - Global data table (shared reference data, no RBAC)
 * - Scoped IAM role for user-level DynamoDB access
 * - Seed Lambda (Custom Resource) to populate tables from fixture data
 *
 * SSM params written:
 * - /{projectName}/{environment}/data/user-table-name
 * - /{projectName}/{environment}/data/user-table-arn
 * - /{projectName}/{environment}/data/global-table-name
 * - /{projectName}/{environment}/data/global-table-arn
 * - /{projectName}/{environment}/data/scoped-role-arn
 */
import * as cdk from 'aws-cdk-lib'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as lambda_ from 'aws-cdk-lib/aws-lambda'
import * as cr from 'aws-cdk-lib/custom-resources'
import * as ssm from 'aws-cdk-lib/aws-ssm'
import { Construct } from 'constructs'
import * as path from 'path'

export interface DataStackProps extends cdk.StackProps {
  projectName: string
  environment: string
}

export class DataStack extends cdk.Stack {
  public readonly userTableName: string
  public readonly globalTableName: string
  public readonly scopedRoleArn: string

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props)

    const { projectName, environment } = props

    // ============================================================
    // DynamoDB Tables
    // ============================================================

    // Per-user table — RBAC enforced via IAM LeadingKeys condition on PK
    const userTable = new dynamodb.Table(this, 'UserDataTable', {
      tableName: `${projectName}-user-data`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    // Global reference table — no RBAC (company policies, office info, handbook)
    const globalTable = new dynamodb.Table(this, 'GlobalDataTable', {
      tableName: `${projectName}-global-data`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    // ============================================================
    // Scoped IAM Role — assumed by Interceptor Lambda per-request
    // with session tags (user_id) for RBAC
    // ============================================================

    // Read the interceptor Lambda role ARN from SSM at deploy time
    // (written by gateway-stack). Since data-stack deploys before gateway-stack,
    // we use a wildcard trust and constrain via sts:TagSession condition.
    const scopedRole = new iam.Role(this, 'UserScopedRole', {
      roleName: `${projectName}-user-scoped-access`,
      description: 'Assumed per-request with session tags for user-scoped DynamoDB access',
      assumedBy: new iam.CompositePrincipal(
        // Allow the account root (interceptor Lambda role will assume this)
        new iam.AccountPrincipal(this.account),
      ),
      maxSessionDuration: cdk.Duration.hours(1),
    })

    // Allow sts:TagSession in the trust policy (required for session tags)
    scopedRole.assumeRolePolicy!.addStatements(
      new iam.PolicyStatement({
        sid: 'AllowTagSession',
        effect: iam.Effect.ALLOW,
        principals: [new iam.AccountPrincipal(this.account)],
        actions: ['sts:TagSession'],
      }),
      // Require that the caller sets the user_id tag when assuming this role
      new iam.PolicyStatement({
        sid: 'RequireUserIdTag',
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ['sts:AssumeRole'],
        conditions: {
          'Null': {
            'aws:RequestTag/user_id': 'true',
          },
        },
      })
    )

    // DynamoDB RBAC: role-based data scope
    //
    // Default: users can only read their own partition (PK = user_id)
    // HR_Manager: can read all users' data (team oversight)
    //
    // IAM evaluation: any ALLOW wins, so HR_Manager matches the first
    // statement and gets full table read; others only match the second.

    scopedRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'HRManagerFullTableRead',
        effect: iam.Effect.ALLOW,
        actions: [
          'dynamodb:GetItem',
          'dynamodb:Query',
          'dynamodb:BatchGetItem',
          'dynamodb:Scan',
        ],
        resources: [userTable.tableArn],
        conditions: {
          'StringEquals': {
            'aws:PrincipalTag/role': 'HR_Manager',
          },
        },
      })
    )

    scopedRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'UserScopedDynamoDBRead',
        effect: iam.Effect.ALLOW,
        actions: [
          'dynamodb:GetItem',
          'dynamodb:Query',
          'dynamodb:BatchGetItem',
        ],
        resources: [userTable.tableArn],
        conditions: {
          'ForAllValues:StringEquals': {
            'dynamodb:LeadingKeys': ['${aws:PrincipalTag/user_id}'],
          },
        },
      })
    )

    // ============================================================
    // Seed Lambda — populates tables with fixture data on deploy
    // ============================================================

    const seederLambda = new lambda_.Function(this, 'DataSeeder', {
      functionName: `${projectName}-data-seeder`,
      runtime: lambda_.Runtime.PYTHON_3_13,
      handler: 'index.handler',
      code: lambda_.Code.fromAsset(path.join(__dirname, '../lambda/data-seeder')),
      timeout: cdk.Duration.minutes(2),
      memorySize: 256,
      environment: {
        USER_TABLE_NAME: userTable.tableName,
        GLOBAL_TABLE_NAME: globalTable.tableName,
      },
    })

    userTable.grantWriteData(seederLambda)
    globalTable.grantWriteData(seederLambda)

    // Custom Resource to trigger seeding on deploy
    const seederProvider = new cr.Provider(this, 'SeederProvider', {
      onEventHandler: seederLambda,
    })

    new cdk.CustomResource(this, 'SeedData', {
      serviceToken: seederProvider.serviceToken,
      properties: {
        // Force re-seed on every deploy by including a timestamp
        Timestamp: new Date().toISOString(),
      },
    })

    // ============================================================
    // SSM Parameters
    // ============================================================

    this.userTableName = userTable.tableName
    this.globalTableName = globalTable.tableName
    this.scopedRoleArn = scopedRole.roleArn

    new ssm.StringParameter(this, 'UserTableNameParam', {
      parameterName: `/${projectName}/${environment}/data/user-table-name`,
      stringValue: userTable.tableName,
      description: 'DynamoDB table name for per-user data (RBAC)',
      tier: ssm.ParameterTier.STANDARD,
    })

    new ssm.StringParameter(this, 'UserTableArnParam', {
      parameterName: `/${projectName}/${environment}/data/user-table-arn`,
      stringValue: userTable.tableArn,
      description: 'DynamoDB table ARN for per-user data',
      tier: ssm.ParameterTier.STANDARD,
    })

    new ssm.StringParameter(this, 'GlobalTableNameParam', {
      parameterName: `/${projectName}/${environment}/data/global-table-name`,
      stringValue: globalTable.tableName,
      description: 'DynamoDB table name for global reference data',
      tier: ssm.ParameterTier.STANDARD,
    })

    new ssm.StringParameter(this, 'GlobalTableArnParam', {
      parameterName: `/${projectName}/${environment}/data/global-table-arn`,
      stringValue: globalTable.tableArn,
      description: 'DynamoDB table ARN for global reference data',
      tier: ssm.ParameterTier.STANDARD,
    })

    new ssm.StringParameter(this, 'ScopedRoleArnParam', {
      parameterName: `/${projectName}/${environment}/data/scoped-role-arn`,
      stringValue: scopedRole.roleArn,
      description: 'IAM role ARN for user-scoped DynamoDB access (assumed with session tags)',
      tier: ssm.ParameterTier.STANDARD,
    })

    // ============================================================
    // Outputs
    // ============================================================

    new cdk.CfnOutput(this, 'UserTableNameOutput', {
      value: userTable.tableName,
      description: 'Per-user DynamoDB table (RBAC)',
    })

    new cdk.CfnOutput(this, 'GlobalTableNameOutput', {
      value: globalTable.tableName,
      description: 'Global reference DynamoDB table',
    })

    new cdk.CfnOutput(this, 'ScopedRoleArnOutput', {
      value: scopedRole.roleArn,
      description: 'IAM role for user-scoped access (assumed with session tags)',
    })
  }
}
