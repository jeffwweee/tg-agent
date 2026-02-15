#!/bin/bash
#
# Telegram Webhook Management Script
#
# Manages the Telegram bot webhook for tg-agent.
#
# Usage:
#   ./webhook.sh [command] [options]
#
# Commands:
#   set <url>     Set webhook URL (or use --tunnel to auto-detect)
#   delete        Delete the current webhook
#   info          Show current webhook info
#   --tunnel      Auto-detect tunnel URL and set webhook
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOGS_DIR="$PROJECT_DIR/logs"
TUNNEL_LOG="$LOGS_DIR/tunnel.log"

# Load environment
if [ -f "$PROJECT_DIR/.env" ]; then
    export $(grep -v '^#' "$PROJECT_DIR/.env" | xargs)
fi

# Check for bot token
if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
    echo -e "${RED}ERROR: TELEGRAM_BOT_TOKEN not set in .env${NC}"
    exit 1
fi

API_URL="https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}"

set_webhook() {
    local url="$1"

    if [ -z "$url" ]; then
        echo -e "${RED}ERROR: Webhook URL required${NC}"
        echo "Usage: $0 set <url>"
        exit 1
    fi

    local webhook_url="${url%/}/telegram/webhook"

    echo -e "${YELLOW}Setting webhook to: $webhook_url${NC}"

    response=$(curl -s -X POST "$API_URL/setWebhook" \
        -H "Content-Type: application/json" \
        -d "{\"url\": \"$webhook_url\"}")

    if echo "$response" | jq -e '.ok' > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Webhook set successfully${NC}"
        echo "$response" | jq .
    else
        echo -e "${RED}✗ Failed to set webhook${NC}"
        echo "$response" | jq .
        exit 1
    fi
}

set_webhook_from_tunnel() {
    if [ ! -f "$TUNNEL_LOG" ]; then
        echo -e "${RED}ERROR: Tunnel log not found. Is the tunnel running?${NC}"
        exit 1
    fi

    tunnel_url=$(grep -o 'https://[^.]*\.trycloudflare\.com' "$TUNNEL_LOG" | head -1)

    if [ -z "$tunnel_url" ]; then
        echo -e "${RED}ERROR: Could not find tunnel URL in logs${NC}"
        echo "Make sure cloudflared tunnel is running"
        exit 1
    fi

    echo -e "${GREEN}Found tunnel URL: $tunnel_url${NC}"
    set_webhook "$tunnel_url"
}

delete_webhook() {
    echo -e "${YELLOW}Deleting webhook...${NC}"

    response=$(curl -s -X POST "$API_URL/deleteWebhook")

    if echo "$response" | jq -e '.ok' > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Webhook deleted${NC}"
        echo "$response" | jq .
    else
        echo -e "${RED}✗ Failed to delete webhook${NC}"
        echo "$response" | jq .
        exit 1
    fi
}

show_info() {
    echo -e "${YELLOW}Webhook Info:${NC}"
    curl -s "$API_URL/getWebhookInfo" | jq .
}

# Parse command
case "${1:-}" in
    set)
        if [ "$2" = "--tunnel" ]; then
            set_webhook_from_tunnel
        else
            set_webhook "$2"
        fi
        ;;
    delete)
        delete_webhook
        ;;
    info)
        show_info
        ;;
    --tunnel)
        set_webhook_from_tunnel
        ;;
    *)
        echo "Usage: $0 {set <url>|set --tunnel|delete|info}"
        echo ""
        echo "Commands:"
        echo "  set <url>      Set webhook URL"
        echo "  set --tunnel   Auto-detect tunnel URL and set webhook"
        echo "  delete         Delete current webhook"
        echo "  info           Show webhook info"
        exit 1
        ;;
esac
