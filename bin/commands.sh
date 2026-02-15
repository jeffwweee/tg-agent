#!/bin/bash

# Telegram Bot Commands Management
#
# Usage:
#   ./bin/commands.sh sync    # Sync commands with Telegram
#   ./bin/commands.sh list    # List current commands
#   ./bin/commands.sh clear   # Clear all commands

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
COMMAND="${1:-sync}"

cd "$PROJECT_ROOT"

node scripts/sync-commands.mjs "$COMMAND"
