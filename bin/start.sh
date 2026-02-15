#!/bin/bash
#
# tg-agent Startup Script
#
# Starts the tg-agent bridge server and optionally the cloudflared tunnel.
#
# Usage:
#   ./start.sh [options]
#
# Options:
#   -h, --help          Show this help message
#   -d, --daemon        Run in background (daemon mode)
#   -t, --tunnel        Also start cloudflared tunnel
#   -s, --stop          Stop all services
#   -r, --restart       Restart all services
#   --status            Check status of services
#   --logs              Tail logs from all services
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOGS_DIR="$PROJECT_DIR/logs"
PID_DIR="$PROJECT_DIR/.pids"

# Create necessary directories
mkdir -p "$LOGS_DIR" "$PID_DIR"

# Service names
SERVER_NAME="tg-agent"
TUNNEL_NAME="cloudflared"

# PID files
SERVER_PID="$PID_DIR/server.pid"
TUNNEL_PID="$PID_DIR/tunnel.pid"

# Log files
SERVER_LOG="$LOGS_DIR/server.log"
TUNNEL_LOG="$LOGS_DIR/tunnel.log"

# Load environment
if [ -f "$PROJECT_DIR/.env" ]; then
    export $(grep -v '^#' "$PROJECT_DIR/.env" | xargs)
fi

# Default options
DAEMON=false
START_TUNNEL=false
ACTION="start"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            head -20 "$0" | tail -18
            exit 0
            ;;
        -d|--daemon)
            DAEMON=true
            shift
            ;;
        -t|--tunnel)
            START_TUNNEL=true
            shift
            ;;
        -s|--stop)
            ACTION="stop"
            shift
            ;;
        -r|--restart)
            ACTION="restart"
            shift
            ;;
        --status)
            ACTION="status"
            shift
            ;;
        --logs)
            ACTION="logs"
            shift
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

is_running() {
    local pid_file="$1"
    local name="$2"

    if [ -f "$pid_file" ]; then
        local pid=$(cat "$pid_file")
        if ps -p "$pid" > /dev/null 2>&1; then
            return 0
        fi
    fi
    return 1
}

start_server() {
    if is_running "$SERVER_PID" "$SERVER_NAME"; then
        log_warn "$SERVER_NAME is already running (PID: $(cat $SERVER_PID))"
        return 0
    fi

    log_info "Starting $SERVER_NAME..."

    cd "$PROJECT_DIR"

    if [ "$DAEMON" = true ]; then
        nohup npm run start:dev > "$SERVER_LOG" 2>&1 &
        echo $! > "$SERVER_PID"
        log_info "$SERVER_NAME started (PID: $(cat $SERVER_PID))"
    else
        npm run start:dev
    fi
}

stop_server() {
    if ! is_running "$SERVER_PID" "$SERVER_NAME"; then
        log_warn "$SERVER_NAME is not running"
        return 0
    fi

    local pid=$(cat "$SERVER_PID")
    log_info "Stopping $SERVER_NAME (PID: $pid)..."
    kill "$pid" 2>/dev/null || true
    rm -f "$SERVER_PID"
    log_info "$SERVER_NAME stopped"
}

start_tunnel() {
    if is_running "$TUNNEL_PID" "$TUNNEL_NAME"; then
        log_warn "$TUNNEL_NAME is already running (PID: $(cat $TUNNEL_PID))"
        return 0
    fi

    if ! command -v cloudflared &> /dev/null; then
        log_error "cloudflared is not installed. Install it from: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
        return 1
    fi

    log_info "Starting $TUNNEL_NAME..."

    if [ "$DAEMON" = true ]; then
        nohup cloudflared tunnel --url http://localhost:${PORT:-3000} > "$TUNNEL_LOG" 2>&1 &
        echo $! > "$TUNNEL_PID"

        # Wait for tunnel to start and get URL
        sleep 3
        TUNNEL_URL=$(grep -o 'https://[^.]*\.trycloudflare\.com' "$TUNNEL_LOG" | head -1)

        log_info "$TUNNEL_NAME started (PID: $(cat $TUNNEL_PID))"
        if [ -n "$TUNNEL_URL" ]; then
            log_info "Tunnel URL: $TUNNEL_URL"
        fi
    else
        cloudflared tunnel --url http://localhost:${PORT:-3000}
    fi
}

stop_tunnel() {
    if ! is_running "$TUNNEL_PID" "$TUNNEL_NAME"; then
        log_warn "$TUNNEL_NAME is not running"
        return 0
    fi

    local pid=$(cat "$TUNNEL_PID")
    log_info "Stopping $TUNNEL_NAME (PID: $pid)..."
    kill "$pid" 2>/dev/null || true
    rm -f "$TUNNEL_PID"
    log_info "$TUNNEL_NAME stopped"
}

show_status() {
    echo ""
    echo -e "${BLUE}=== tg-agent Status ===${NC}"
    echo ""

    if is_running "$SERVER_PID" "$SERVER_NAME"; then
        echo -e "$SERVER_NAME: ${GREEN}running${NC} (PID: $(cat $SERVER_PID))"
    else
        echo -e "$SERVER_NAME: ${RED}stopped${NC}"
    fi

    if is_running "$TUNNEL_PID" "$TUNNEL_NAME"; then
        echo -e "$TUNNEL_NAME: ${GREEN}running${NC} (PID: $(cat $TUNNEL_PID))"
        TUNNEL_URL=$(grep -o 'https://[^.]*\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -1)
        if [ -n "$TUNNEL_URL" ]; then
            echo -e "  URL: $TUNNEL_URL"
        fi
    else
        echo -e "$TUNNEL_NAME: ${RED}stopped${NC}"
    fi

    # Show health check
    echo ""
    echo -e "${BLUE}Health Check:${NC}"
    if curl -s "http://localhost:${PORT:-3000}/health" 2>/dev/null | jq . 2>/dev/null; then
        :
    else
        echo -e "  ${YELLOW}Server not responding${NC}"
    fi

    echo ""
}

tail_logs() {
    log_info "Tailing logs (Ctrl+C to stop)..."

    if [ -f "$SERVER_LOG" ]; then
        echo -e "${BLUE}=== Server Log ===${NC}"
        tail -f "$SERVER_LOG" &
        SERVER_TAIL_PID=$!
    fi

    if [ -f "$TUNNEL_LOG" ]; then
        echo -e "${BLUE}=== Tunnel Log ===${NC}"
        tail -f "$TUNNEL_LOG" &
        TUNNEL_TAIL_PID=$!
    fi

    # Wait for interrupt
    trap 'kill $SERVER_TAIL_PID $TUNNEL_TAIL_PID 2>/dev/null; exit 0' INT
    wait
}

# Main logic
case $ACTION in
    start)
        start_server
        if [ "$START_TUNNEL" = true ]; then
            start_tunnel
        fi
        ;;
    stop)
        stop_server
        stop_tunnel
        ;;
    restart)
        stop_server
        stop_tunnel
        sleep 1
        start_server
        if [ "$START_TUNNEL" = true ]; then
            start_tunnel
        fi
        ;;
    status)
        show_status
        ;;
    logs)
        tail_logs
        ;;
esac
