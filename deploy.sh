#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="${SCRIPT_DIR}/infra"
PROJECT="multi-agent-concierge"
ENVIRONMENT="dev"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}✓${NC} $1"; }
log_warn()  { echo -e "${YELLOW}⚠${NC} $1"; }
log_error() { echo -e "${RED}✗${NC} $1"; }
log_step()  { echo -e "${BLUE}▶${NC} $1"; }

# ============================================================
# Setup
# ============================================================

check_aws() {
  log_step "Checking AWS credentials..."
  if ! command -v aws &> /dev/null; then
    log_error "AWS CLI is not installed"
    exit 1
  fi
  ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null || true)
  if [ -z "${ACCOUNT_ID}" ]; then
    log_error "Cannot determine AWS account. Check your AWS credentials."
    exit 1
  fi
  REGION="${AWS_DEFAULT_REGION:-${CDK_DEFAULT_REGION:-us-west-2}}"
  export CDK_DEFAULT_ACCOUNT="${ACCOUNT_ID}"
  export CDK_DEFAULT_REGION="${REGION}"
  export AWS_DEFAULT_REGION="${REGION}"
  log_info "Account: ${ACCOUNT_ID} | Region: ${REGION}"
  echo ""
}

ensure_infra() {
  cd "${INFRA_DIR}"
  if [ ! -d "node_modules" ]; then
    log_step "Installing CDK dependencies..."
    npm install --silent
    echo ""
  fi
}

# ============================================================
# Deploy functions (phased — SSM-based, no cross-stack deps)
# ============================================================

deploy_stacks() {
  local stacks=("$@")
  log_step "Deploying: ${stacks[*]}"
  echo ""
  cd "${INFRA_DIR}"
  npx cdk deploy "${stacks[@]}" --exclusively --concurrency 5 --require-approval never
}

deploy_all() {
  log_step "Full stack deployment (phased)..."
  echo ""
  cd "${INFRA_DIR}"

  # Phase 1: Auth (writes SSM params)
  log_step "Phase 1/6: Auth (Cognito + OAuth2 credential provider)..."
  npx cdk deploy "${PROJECT}-auth" --exclusively --require-approval never
  echo ""

  # Phase 1.5: Data (DynamoDB tables + RBAC scoped role)
  log_step "Phase 1.5/6: Data (DynamoDB tables + RBAC IAM role)..."
  npx cdk deploy "${PROJECT}-data" --exclusively --require-approval never
  echo ""

  # Phase 2: Component Runtimes (reads auth SSM, writes runtime SSM)
  log_step "Phase 2/6: Component Runtimes (5 sub-agents)..."
  npx cdk deploy \
    "${PROJECT}-hr" \
    "${PROJECT}-it-support" \
    "${PROJECT}-finance" \
    "${PROJECT}-productivity" \
    "${PROJECT}-knowledge" \
    --exclusively --concurrency 5 --require-approval never
  echo ""

  # Phase 3: Registry (reads runtime SSM, registers agents in catalog)
  log_step "Phase 3/6: Registry (agent catalog + governance)..."
  npx cdk deploy "${PROJECT}-registry" --exclusively --require-approval never
  echo ""

  # Phase 4: Gateway (reads auth + runtime + data SSM)
  log_step "Phase 4/6: Gateway..."
  npx cdk deploy "${PROJECT}-gateway" --exclusively --require-approval never
  echo ""

  # Phase 5: Orchestrator (reads gateway + registry SSM)
  log_step "Phase 5/6: Orchestrator Runtime..."
  npx cdk deploy "${PROJECT}-runtime" --exclusively --require-approval never \
    --outputs-file "${SCRIPT_DIR}/cdk-outputs.json"
  echo ""
}

# ============================================================
# Menu handlers
# ============================================================

deploy_infra() {
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Deploying Auth"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  deploy_stacks "${PROJECT}-auth"
  log_info "Auth deployment complete!"
}

deploy_data() {
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Deploying Data (DynamoDB + RBAC)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  deploy_stacks "${PROJECT}-data"
  log_info "Data deployment complete!"
}

deploy_sub_agents() {
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Sub-Agent Runtimes (5 MCP)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "  1) HR                 (Employee profiles, PTO, performance, onboarding)"
  echo "  2) IT Support         (Tickets, software access, equipment, service status)"
  echo "  3) Finance            (Expenses, budgets, invoices, reimbursements)"
  echo "  4) Productivity       (Calendar, documents, meeting notes)"
  echo "  5) Knowledge          (Company policies, employee handbook, office info)"
  echo "  a) All sub-agents"
  echo "  0) Back to main menu"
  echo ""

  read -p "Select sub-agent (0-5/a): " SUB_OPTION
  echo ""

  case $SUB_OPTION in
    1) deploy_stacks "${PROJECT}-hr" ;;
    2) deploy_stacks "${PROJECT}-it-support" ;;
    3) deploy_stacks "${PROJECT}-finance" ;;
    4) deploy_stacks "${PROJECT}-productivity" ;;
    5) deploy_stacks "${PROJECT}-knowledge" ;;
    a) deploy_stacks "${PROJECT}-hr" "${PROJECT}-it-support" "${PROJECT}-finance" "${PROJECT}-productivity" "${PROJECT}-knowledge" ;;
    0) return ;;
    *) log_error "Invalid option"; exit 1 ;;
  esac

  log_info "Sub-agent deployment complete!"
}

deploy_registry() {
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Deploying Registry (Agent Catalog)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  deploy_stacks "${PROJECT}-registry"
  log_info "Registry deployment complete!"
}

deploy_gateway() {
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Deploying Gateway Stack"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  deploy_stacks "${PROJECT}-gateway"
  log_info "Gateway deployment complete!"
}

deploy_orchestrator() {
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Deploying Orchestrator Runtime"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  deploy_stacks "${PROJECT}-runtime"
  log_info "Orchestrator runtime deployment complete!"
}

deploy_full_stack() {
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Deploying All Stacks (Phased)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  deploy_all
  log_info "Full stack deployment complete!"
}

display_menu() {
  echo "What would you like to deploy?"
  echo ""
  echo "  1) Auth               (Cognito, OAuth2 credential provider)"
  echo "  2) Data               (DynamoDB tables + RBAC IAM role)"
  echo "  3) Sub-Agents         (5 domain agents)"
  echo "  4) Registry           (Agent catalog + governance)"
  echo "  5) Gateway            (MCP Gateway with 5 MCP targets)"
  echo "  6) Orchestrator       (Concierge agent runtime with Memory)"
  echo "  7) Full Stack         (All components — phased deployment)"
  echo ""
  echo "  0) Exit"
  echo ""
}

# ============================================================
# Main
# ============================================================

main() {
  echo "========================================"
  echo "  Multi-Agent Concierge on AgentCore"
  echo "  Deployment"
  echo "========================================"
  echo ""

  check_aws
  ensure_infra
  display_menu

  read -p "Select option (0-7): " OPTION
  echo ""

  case $OPTION in
    1) deploy_infra ;;
    2) deploy_data ;;
    3) deploy_sub_agents ;;
    4) deploy_registry ;;
    5) deploy_gateway ;;
    6) deploy_orchestrator ;;
    7) deploy_full_stack ;;
    0) log_info "Exiting..."; exit 0 ;;
    *) log_error "Invalid option. Please select 0-7."; exit 1 ;;
  esac

  echo ""
  echo "========================================"
  log_info "Deployment Complete!"
  echo "========================================"
  echo ""
}

main
