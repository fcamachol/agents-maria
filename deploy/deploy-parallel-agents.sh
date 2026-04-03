#!/bin/bash
# ============================================
# Parallel Multi-Agent Deployment Script
# Deploys CEA v2.0, PACO, and Gobierno stacks in parallel
# ============================================
#
# Usage:
#   bash deploy/deploy-parallel-agents.sh              # Deploy all in parallel
#   bash deploy/deploy-parallel-agents.sh --stack cea   # Deploy only CEA
#   bash deploy/deploy-parallel-agents.sh --stack paco  # Deploy only PACO
#   bash deploy/deploy-parallel-agents.sh --stack gobierno # Deploy only Gobierno
#   bash deploy/deploy-parallel-agents.sh --dry-run     # Show what would be deployed
#   bash deploy/deploy-parallel-agents.sh --down         # Stop all stacks
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Arguments
STACK="${2:-all}"
DRY_RUN=false
STOP_ALL=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --stack) STACK="$2"; shift 2 ;;
        --dry-run) DRY_RUN=true; shift ;;
        --down) STOP_ALL=true; shift ;;
        *) shift ;;
    esac
done

# Compose file paths
CEA_COMPOSE="$PROJECT_DIR/docker-compose.yml"
PACO_COMPOSE="-f $PROJECT_DIR/paco/docker-compose.yml"
GOBIERNO_COMPOSE="-f $PROJECT_DIR/gobierno-queretaro/docker-compose.yml"

# Add production overrides if they exist
[ -f "$PROJECT_DIR/paco/docker-compose.prod.yml" ] && \
    PACO_COMPOSE="$PACO_COMPOSE -f $PROJECT_DIR/paco/docker-compose.prod.yml"
[ -f "$PROJECT_DIR/gobierno-queretaro/docker-compose.prod.yml" ] && \
    GOBIERNO_COMPOSE="$GOBIERNO_COMPOSE -f $PROJECT_DIR/gobierno-queretaro/docker-compose.prod.yml"

# Deployment log directory
LOG_DIR="$PROJECT_DIR/deploy/logs"
mkdir -p "$LOG_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# ============================================
# Functions
# ============================================

log() {
    echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[$(date +%H:%M:%S)] ✓${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[$(date +%H:%M:%S)] !${NC} $1"
}

log_error() {
    echo -e "${RED}[$(date +%H:%M:%S)] ✗${NC} $1"
}

# --- Pre-flight checks ---
preflight() {
    log "Running pre-flight checks..."

    if ! command -v docker &>/dev/null; then
        log_error "Docker not installed. Run setup-vm.sh first."
        exit 1
    fi

    if ! docker compose version &>/dev/null; then
        log_error "Docker Compose plugin not found."
        exit 1
    fi

    local avail_mb
    avail_mb=$(free -m | awk '/^Mem:/{print $7}')
    local disk_avail
    disk_avail=$(df -m / | awk 'NR==2{print $4}')

    echo ""
    echo -e "  ${CYAN}System Resources:${NC}"
    echo "  RAM:    $(free -h | awk '/^Mem:/{print $2}') total, $(free -h | awk '/^Mem:/{print $7}') available"
    echo "  CPUs:   $(nproc)"
    echo "  Disk:   $(df -h / | awk 'NR==2{print $4}') free"
    echo "  Docker: $(docker --version | cut -d' ' -f3)"
    echo ""

    # Resource warnings
    if [ "$avail_mb" -lt 2048 ]; then
        log_error "Less than 2GB RAM available ($avail_mb MB). Cannot deploy safely."
        exit 1
    elif [ "$avail_mb" -lt 4096 ]; then
        log_warn "Less than 4GB RAM available ($avail_mb MB). Deployment may be tight."
    fi

    if [ "$disk_avail" -lt 5120 ]; then
        log_error "Less than 5GB disk available. Cannot deploy safely."
        exit 1
    fi

    log_success "Pre-flight checks passed"
}

# --- Validate .env ---
validate_env() {
    local dir=$1
    local name=$2

    if [ ! -f "$dir/.env" ]; then
        if [ -f "$dir/.env.example" ]; then
            cp "$dir/.env.example" "$dir/.env"
            log_warn "Created $name/.env from .env.example - edit with your API keys"
            return 1
        else
            log_warn "No .env file for $name (may use parent env)"
            return 0
        fi
    fi
    return 0
}

# --- Health check with retries ---
check_health() {
    local name=$1
    local url=$2
    local max_retries=${3:-5}
    local retry=0

    while [ $retry -lt $max_retries ]; do
        if curl -sf --max-time 5 "$url" > /dev/null 2>&1; then
            log_success "$name"
            return 0
        fi
        retry=$((retry + 1))
        sleep 3
    done
    log_warn "$name (not ready after ${max_retries} attempts)"
    return 1
}

# --- Deploy CEA Agent v2.0 ---
deploy_cea() {
    local log_file="$LOG_DIR/cea_${TIMESTAMP}.log"
    log "Deploying CEA Agent v2.0..."

    if [ "$DRY_RUN" = true ]; then
        log "[DRY RUN] Would deploy: docker compose -f $CEA_COMPOSE up -d --build"
        return 0
    fi

    validate_env "$PROJECT_DIR" "cea-agent" || return 1

    cd "$PROJECT_DIR"
    docker compose -f "$CEA_COMPOSE" up -d --build > "$log_file" 2>&1
    local exit_code=$?

    if [ $exit_code -eq 0 ]; then
        log_success "CEA Agent v2.0 deployed (1 container)"
    else
        log_error "CEA Agent v2.0 failed. See $log_file"
    fi
    return $exit_code
}

# --- Deploy PACO Stack ---
deploy_paco() {
    local log_file="$LOG_DIR/paco_${TIMESTAMP}.log"
    log "Deploying PACO stack..."

    if [ "$DRY_RUN" = true ]; then
        log "[DRY RUN] Would deploy: docker compose $PACO_COMPOSE up -d --build"
        return 0
    fi

    validate_env "$PROJECT_DIR/paco" "paco" || return 1

    cd "$PROJECT_DIR/paco"
    docker compose $PACO_COMPOSE up -d --build > "$log_file" 2>&1
    local exit_code=$?

    if [ $exit_code -eq 0 ]; then
        log_success "PACO stack deployed (10 containers)"
    else
        log_error "PACO stack failed. See $log_file"
    fi
    return $exit_code
}

# --- Deploy Gobierno Stack ---
deploy_gobierno() {
    local log_file="$LOG_DIR/gobierno_${TIMESTAMP}.log"
    log "Deploying Gobierno Queretaro stack..."

    if [ "$DRY_RUN" = true ]; then
        log "[DRY RUN] Would deploy: docker compose $GOBIERNO_COMPOSE up -d --build"
        return 0
    fi

    validate_env "$PROJECT_DIR/gobierno-queretaro" "gobierno-queretaro" || return 1

    cd "$PROJECT_DIR/gobierno-queretaro"

    # Validate ANTHROPIC_API_KEY
    if [ -f .env ]; then
        set -a; source .env; set +a
        if [ -z "${ANTHROPIC_API_KEY:-}" ] || [ "$ANTHROPIC_API_KEY" = "sk-ant-api03-xxx" ]; then
            log_error "Set ANTHROPIC_API_KEY in gobierno-queretaro/.env"
            return 1
        fi
    fi

    docker compose $GOBIERNO_COMPOSE up -d --build > "$log_file" 2>&1
    local exit_code=$?

    if [ $exit_code -eq 0 ]; then
        log_success "Gobierno stack deployed (18 containers)"
    else
        log_error "Gobierno stack failed. See $log_file"
    fi
    return $exit_code
}

# --- Verify all health endpoints ---
verify_health() {
    local failed=0
    echo ""
    log "Running health checks..."
    echo ""

    if [ "$STACK" = "all" ] || [ "$STACK" = "cea" ]; then
        echo -e "  ${CYAN}CEA Agent v2.0:${NC}"
        check_health "  CEA Agent        (3000)" "http://127.0.0.1:3000/health" || failed=$((failed + 1))
        echo ""
    fi

    if [ "$STACK" = "all" ] || [ "$STACK" = "paco" ]; then
        echo -e "  ${CYAN}PACO Stack:${NC}"
        check_health "  PACO Backend     (8000)" "http://127.0.0.1:8000/health" || failed=$((failed + 1))
        check_health "  Langfuse         (3001)" "http://127.0.0.1:3001" || true
        check_health "  PACO Frontend    (3006)" "http://127.0.0.1:3006" || true
        check_health "  Maria Claude     (3002)" "http://127.0.0.1:3002/health" || true
        check_health "  CEA Tools MCP    (3010)" "http://127.0.0.1:3010/health" || true
        check_health "  AGORA Tools MCP  (3011)" "http://127.0.0.1:3011/health" || true
        echo ""
    fi

    if [ "$STACK" = "all" ] || [ "$STACK" = "gobierno" ]; then
        echo -e "  ${CYAN}Gobierno Queretaro:${NC}"
        check_health "  Orchestrator     (9100)" "http://127.0.0.1:9100/health" || failed=$((failed + 1))
        check_health "  Jaeger UI        (16686)" "http://127.0.0.1:16686" || true

        # Check all 13 agent containers
        for port in 9101 9102 9103 9104 9105 9106 9107 9108 9109 9110 9111 9112 9113; do
            check_health "  Agent (port $port)" "http://127.0.0.1:$port/health" 3 || true
        done

        check_health "  Voice Gateway    (9190)" "http://127.0.0.1:9190/health" 3 || true
        echo ""
    fi

    return $failed
}

# --- Stop all stacks ---
stop_all() {
    log "Stopping all stacks..."

    cd "$PROJECT_DIR"
    docker compose -f "$CEA_COMPOSE" down 2>/dev/null || true

    cd "$PROJECT_DIR/paco"
    docker compose $PACO_COMPOSE down 2>/dev/null || true

    cd "$PROJECT_DIR/gobierno-queretaro"
    docker compose $GOBIERNO_COMPOSE down 2>/dev/null || true

    log_success "All stacks stopped."
    exit 0
}

# ============================================
# Main Execution
# ============================================

echo ""
echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE} Parallel Multi-Agent Deployment             ${NC}"
echo -e "${BLUE} CEA v2.0 + PACO + Gobierno Queretaro        ${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

if [ "$STOP_ALL" = true ]; then
    stop_all
fi

preflight

# Track background PIDs and exit codes
declare -A PIDS
declare -A EXIT_CODES
DEPLOY_FAILED=false

deploy_stack_bg() {
    local stack_name=$1
    local deploy_fn=$2

    $deploy_fn &
    PIDS[$stack_name]=$!
    log "  Started $stack_name (PID ${PIDS[$stack_name]})"
}

echo ""
log "Launching parallel deployments..."
echo ""

# Launch deployments in parallel based on target
case "$STACK" in
    all)
        deploy_stack_bg "cea" deploy_cea
        deploy_stack_bg "paco" deploy_paco
        deploy_stack_bg "gobierno" deploy_gobierno
        ;;
    cea)
        deploy_stack_bg "cea" deploy_cea
        ;;
    paco)
        deploy_stack_bg "paco" deploy_paco
        ;;
    gobierno)
        deploy_stack_bg "gobierno" deploy_gobierno
        ;;
    *)
        log_error "Unknown stack: $STACK"
        echo "Usage: $0 [--stack cea|paco|gobierno] [--dry-run] [--down]"
        exit 1
        ;;
esac

# Wait for all deployments to complete
echo ""
log "Waiting for deployments to complete..."

for stack_name in "${!PIDS[@]}"; do
    wait "${PIDS[$stack_name]}" 2>/dev/null
    EXIT_CODES[$stack_name]=$?
    if [ "${EXIT_CODES[$stack_name]}" -ne 0 ]; then
        log_error "$stack_name deployment failed (exit code ${EXIT_CODES[$stack_name]})"
        DEPLOY_FAILED=true
    fi
done

if [ "$DRY_RUN" = true ]; then
    echo ""
    log_success "Dry run complete. No containers were started."
    exit 0
fi

# Summary of deployment results
echo ""
echo -e "${CYAN}Deployment Results:${NC}"
for stack_name in "${!EXIT_CODES[@]}"; do
    if [ "${EXIT_CODES[$stack_name]}" -eq 0 ]; then
        log_success "$stack_name"
    else
        log_error "$stack_name (exit ${EXIT_CODES[$stack_name]})"
    fi
done

if [ "$DEPLOY_FAILED" = true ]; then
    log_error "Some deployments failed. Check logs in $LOG_DIR"
fi

# Wait for containers to initialize
echo ""
log "Waiting 20s for services to initialize..."
sleep 20

# Run health checks
if ! verify_health; then
    log_warn "Some health checks failed. Services may still be starting."
    echo "  Check individual logs:"
    echo "    docker compose -f $CEA_COMPOSE logs -f"
    echo "    docker compose $PACO_COMPOSE logs -f"
    echo "    docker compose $GOBIERNO_COMPOSE logs -f"
fi

# Show container status
echo ""
echo -e "${CYAN}Running Containers:${NC}"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null | \
    grep -E "(cea|paco|gobierno|maria)" | head -35 || true

# Final summary
echo ""
echo -e "${BLUE}============================================${NC}"
echo -e "${GREEN} Deployment Complete!${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""
echo "Stacks deployed:"
[ "$STACK" = "all" ] || [ "$STACK" = "cea" ] && \
    echo "  CEA Agent v2.0    → http://127.0.0.1:3000"
[ "$STACK" = "all" ] || [ "$STACK" = "paco" ] && \
    echo "  PACO Backend      → http://127.0.0.1:8000" && \
    echo "  PACO Frontend     → http://127.0.0.1:3006" && \
    echo "  Maria Claude      → http://127.0.0.1:3002" && \
    echo "  Langfuse          → http://127.0.0.1:3001"
[ "$STACK" = "all" ] || [ "$STACK" = "gobierno" ] && \
    echo "  Orchestrator      → http://127.0.0.1:9100" && \
    echo "  Jaeger UI         → http://127.0.0.1:16686" && \
    echo "  Voice Gateway     → http://127.0.0.1:9190" && \
    echo "  Agents            → http://127.0.0.1:9101-9113"
echo ""
echo "Logs: $LOG_DIR"
echo ""
echo "Commands:"
echo "  bash deploy/deploy-parallel-agents.sh --down    # Stop all"
echo "  bash deploy/healthcheck.sh                       # Check health"
echo "  docker ps | grep -E '(cea|paco|gobierno)'        # Status"
