/**
 * Registry Stack for AgentCore Registry
 *
 * Creates a central catalog (Registry) and registers each sub-agent as a
 * Registry Record with MCP descriptors.  Records go through an approval
 * workflow before they become discoverable via semantic search.
 *
 * The Registry is a control-plane / build-time resource:
 *   - It holds metadata about every agent (tool schemas, descriptions).
 *   - It does NOT carry runtime traffic — the Gateway does that.
 *   - Consumers (including the Orchestrator) search the Registry to
 *     discover which agents exist and what they can do.
 *
 * NOTE: CloudFormation does not yet have native resource types for
 * AgentCore Registry. We use a Custom Resource Lambda that calls the
 * bedrock-agentcore-control boto3 API directly.
 *
 * All external values (runtime URLs) are read from SSM parameters —
 * no cross-stack Fn::ImportValue dependencies.
 */
import * as cdk from 'aws-cdk-lib'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as lambda_ from 'aws-cdk-lib/aws-lambda'
import * as ssm from 'aws-cdk-lib/aws-ssm'
import * as path from 'path'
import { Construct } from 'constructs'

export interface RegistryStackProps extends cdk.StackProps {
  projectName: string
  environment: string
}

/**
 * Metadata for each sub-agent registered in the Registry.
 * Tool schemas mirror what the MCP server actually exposes.
 */
interface AgentRecordDescriptor {
  componentName: string
  displayName: string
  description: string
  toolName: string
  toolDescription: string
}

const AGENT_DESCRIPTORS: AgentRecordDescriptor[] = [
  {
    componentName: 'hr',
    displayName: 'HR Agent',
    description: 'Human Resources specialist - employee profiles, PTO balances and requests, performance review status and submissions, open job positions, and onboarding checklists.',
    toolName: 'hr_agent',
    toolDescription: 'Handle human resources queries including employee profiles, PTO balances and requests, performance review status and submissions, open job positions, and onboarding checklists. Use this agent for anything related to HR policies, leave management, or employee lifecycle.',
  },
  {
    componentName: 'it-support',
    displayName: 'IT Support Agent',
    description: 'IT Support specialist - support tickets, software access, equipment requests, hardware/software inventory, and IT service status.',
    toolName: 'it_support_agent',
    toolDescription: 'Handle IT support queries including creating and tracking support tickets, requesting software access, submitting equipment requests, reviewing current software and hardware inventory, and checking the status of IT services like email, VPN, GitHub, and Jira. Use this agent for any technical issues or IT resource requests.',
  },
  {
    componentName: 'finance',
    displayName: 'Finance Agent',
    description: 'Finance specialist - expense reports, department budgets, invoice status, vendor payments, and reimbursement tracking.',
    toolName: 'finance_agent',
    toolDescription: 'Handle finance queries including expense report submissions and status, department budget summaries and utilization, invoice status and vendor payments, and reimbursement tracking. Use this agent for anything related to expenses, budgets, or financial reporting.',
  },
  {
    componentName: 'productivity',
    displayName: 'Productivity Agent',
    description: 'Productivity and collaboration specialist - calendar management, meeting scheduling, document search, meeting notes, and task tracking.',
    toolName: 'productivity_agent',
    toolDescription: 'Handle productivity and collaboration queries including calendar management and meeting scheduling, document and report search, meeting notes creation and retrieval, and task tracking. Use this agent for anything related to scheduling, documents, or meeting coordination.',
  },
  {
    componentName: 'knowledge',
    displayName: 'Knowledge Agent',
    description: 'Company Knowledge specialist - company policies, employee handbook, office locations and amenities, and general knowledge base.',
    toolName: 'knowledge_agent',
    toolDescription: 'Handle company knowledge queries including searching and retrieving company policies, employee handbook sections, office location information and amenities, and general knowledge base search. Use this agent for any questions about company rules, policies, benefits, or office information.',
  },
]

export class RegistryStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: RegistryStackProps) {
    super(scope, id, props)

    const { projectName, environment } = props

    const ssmVal = (paramPath: string) =>
      ssm.StringParameter.valueForStringParameter(this, `/${projectName}/${environment}/${paramPath}`)

    // ============================================================
    // Custom Resource Lambda for Registry management
    // ============================================================

    const registryManagerFn = new lambda_.Function(this, 'RegistryManagerFunction', {
      functionName: `${projectName}-registry-manager`,
      runtime: lambda_.Runtime.PYTHON_3_12,
      handler: 'index.lambda_handler',
      code: lambda_.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'registry-manager')),
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
    })

    // Registry management permissions
    registryManagerFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock-agentcore:CreateRegistry',
          'bedrock-agentcore:GetRegistry',
          'bedrock-agentcore:UpdateRegistry',
          'bedrock-agentcore:DeleteRegistry',
          'bedrock-agentcore:ListRegistries',
          'bedrock-agentcore:CreateRegistryRecord',
          'bedrock-agentcore:GetRegistryRecord',
          'bedrock-agentcore:UpdateRegistryRecord',
          'bedrock-agentcore:DeleteRegistryRecord',
          'bedrock-agentcore:ListRegistryRecords',
          'bedrock-agentcore:SubmitRegistryRecordForApproval',
          'bedrock-agentcore:UpdateRegistryRecordStatus',
          // Registry creation internally creates a workload identity
          'bedrock-agentcore:CreateWorkloadIdentity',
          'bedrock-agentcore:GetWorkloadIdentity',
          'bedrock-agentcore:DeleteWorkloadIdentity',
        ],
        resources: ['*'],
      })
    )

    // ============================================================
    // Registry (central catalog)
    // ============================================================

    const registry = new cdk.CustomResource(this, 'AgentRegistry', {
      serviceToken: registryManagerFn.functionArn,
      properties: {
        Action: 'MANAGE_REGISTRY',
        RegistryName: `${projectName}-registry`,
        RegistryDescription: 'Central catalog for enterprise concierge sub-agents. Provides semantic search, governance, and lifecycle management for all domain-specialist agents.',
        AutoApproval: 'true',
      },
    })

    const registryId = registry.getAttString('RegistryId')
    const registryArn = registry.getAttString('RegistryArn')

    // ============================================================
    // Registry Records (one per sub-agent)
    // ============================================================

    for (const agent of AGENT_DESCRIPTORS) {
      const record = new cdk.CustomResource(this, `Record-${agent.componentName}`, {
        serviceToken: registryManagerFn.functionArn,
        properties: {
          Action: 'MANAGE_RECORD',
          RegistryId: registryId,
          RecordName: `${agent.componentName}-agent`,
          RecordDescription: agent.description,
          RecordVersion: '1.0.0',
          DescriptorType: 'MCP',
          ServerName: `${projectName}/${agent.componentName}-mcp-server`,
          ServerDescription: agent.description,
          DisplayName: agent.displayName,
          ToolName: agent.toolName,
          ToolDescription: agent.toolDescription,
          ToolInputSchema: JSON.stringify({
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Natural language query to the agent',
              },
            },
            required: ['query'],
          }),
        },
      })
      record.node.addDependency(registry)
    }

    // ============================================================
    // SSM Parameters (consumed by orchestrator runtime)
    // ============================================================

    new ssm.StringParameter(this, 'RegistryIdParam', {
      parameterName: `/${projectName}/${environment}/registry/registry-id`,
      stringValue: registryId,
      description: 'AgentCore Registry ID for agent discovery',
      tier: ssm.ParameterTier.STANDARD,
    })

    // ============================================================
    // Outputs
    // ============================================================

    new cdk.CfnOutput(this, 'RegistryId', {
      value: registryId,
      description: 'Registry ID for agent discovery',
    })

    new cdk.CfnOutput(this, 'TotalRecords', {
      value: String(AGENT_DESCRIPTORS.length),
      description: `Registered agents: ${AGENT_DESCRIPTORS.map(a => a.displayName).join(', ')}`,
    })
  }
}
