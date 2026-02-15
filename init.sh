#!/bin/bash
# init.sh - tg-agent startup script
# Run this at the start of every session

set -e

PROJECT_NAME="tg-agent"
PORT=${PORT:-3000}

echo "🚀 Starting $PROJECT_NAME..."

# Check for .env file
if [ ! -f ".env" ]; then
  echo "⚠️  No .env file found. Copy .env.example and configure:"
  echo "   cp .env.example .env"
  exit 1
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "📦 Installing dependencies..."
  npm install
fi

# Build if dist doesn't exist (for production start)
if [ ! -d "dist" ] && [ "$1" != "--dev" ]; then
  echo "🔨 Building project..."
  npm run build
fi

# Determine start command
if [ "$1" == "--dev" ]; then
  START_CMD="npm run start:dev"
  echo "🔧 Starting development server..."
else
  START_CMD="npm run start:dev"  # Default to dev for now
  echo "🔧 Starting server..."
fi

# Start server in background
$START_CMD &
SERVER_PID=$!

# Store PID for cleanup
echo $SERVER_PID > .pids/server.pid

# Health check
echo "⏳ Waiting for server on port $PORT..."
sleep 3

# Verify server is running
MAX_RETRIES=5
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  if curl -s "http://localhost:$PORT/health" > /dev/null 2>&1; then
    echo "✅ Server running on http://localhost:$PORT"
    break
  fi
  RETRY_COUNT=$((RETRY_COUNT + 1))
  echo "   Attempt $RETRY_COUNT/$MAX_RETRIES..."
  sleep 2
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
  echo "⚠️  Server health check failed after $MAX_RETRIES attempts"
  echo "   Server may still be starting. Check logs with: tail -f logs/*.log"
fi

echo ""
echo "📍 Ready! Working directory: $(pwd)"
echo "📊 Current state: cat progress.md"
echo "📋 Features: cat tasks.json"
echo ""
echo "To stop server: kill \$(cat .pids/server.pid)"
