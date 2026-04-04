#!/usr/bin/env node
/**
 * Multi-Agent Concierge on AgentCore - CDK Application
 *
 * Stacks communicate via SSM parameters — no cross-stack Fn::ImportValue.
 * Deploy order (enforced by deploy.sh phases, not CF dependencies):
 *   1. Auth Stack (Cognito + OAuth2CredentialProvider → writes SSM)
 *   1.5 Data Stack (DynamoDB tables + scoped IAM role for RBAC → writes SSM)
 *   2. Component Runtime Stacks (5 sub-agents, reads auth SSM → writes runtime SSM)
 *   3. Gateway Stack (reads auth + runtime + data SSM, creates own IAM role)
 *   4. Runtime Stack (orchestrator, reads gateway SSM, creates own memory role)
 */
import 'source-map-support/register'
import * as cdk from 'aws-cdk-lib'
import { AuthStack } from '../lib/auth-stack'
import { DataStack } from '../lib/data-stack'
import { ComponentRuntimeStack } from '../lib/component-runtime-stack'
import { GatewayStack } from '../lib/gateway-stack'
import { RuntimeStack } from '../lib/runtime-stack'

const app = new cdk.App()

const projectName = app.node.tryGetContext('projectName') || 'multi-agent-concierge'
const environment = app.node.tryGetContext('environment') || 'dev'

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || 'us-west-2',
}

// Shared source path — all components share the same parent directory
// so that shared/ fixtures are included in the Docker build context.
const componentsSourcePath = '../agents/components'

// 1. Auth (Cognito + OAuth2CredentialProvider → SSM params)
new AuthStack(app, `${projectName}-auth`, {
  projectName,
  environment,
  env,
})

// 1.5 Data (DynamoDB tables + RBAC scoped role → SSM params)
new DataStack(app, `${projectName}-data`, {
  projectName,
  environment,
  env,
})

// 2. Sub-Agent Runtimes (5 MCP, reads auth config from SSM)
new ComponentRuntimeStack(app, `${projectName}-hr`, {
  projectName,
  environment,
  componentName: 'hr',
  sourcePath: componentsSourcePath,
  env,
})

new ComponentRuntimeStack(app, `${projectName}-it-support`, {
  projectName,
  environment,
  componentName: 'it-support',
  sourcePath: componentsSourcePath,
  env,
})

new ComponentRuntimeStack(app, `${projectName}-finance`, {
  projectName,
  environment,
  componentName: 'finance',
  sourcePath: componentsSourcePath,
  env,
})

new ComponentRuntimeStack(app, `${projectName}-productivity`, {
  projectName,
  environment,
  componentName: 'productivity',
  sourcePath: componentsSourcePath,
  env,
})

new ComponentRuntimeStack(app, `${projectName}-knowledge`, {
  projectName,
  environment,
  componentName: 'knowledge',
  sourcePath: componentsSourcePath,
  env,
})

// 3. Gateway (reads auth + runtime SSM, creates own role)
new GatewayStack(app, `${projectName}-gateway`, {
  projectName,
  environment,
  env,
})

// 4. Orchestrator Runtime (reads gateway SSM, creates own memory role)
new RuntimeStack(app, `${projectName}-runtime`, {
  projectName,
  environment,
  env,
})

app.synth()
