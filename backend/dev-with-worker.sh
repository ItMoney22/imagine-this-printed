#!/bin/bash

# Development script to run both backend API and AI jobs worker
# This ensures the AI Product Builder works properly

echo "🚀 Starting Imagine This Printed Backend (API + Worker)"
echo "================================================"
echo ""

# Check if environment file exists
if [ ! -f .env ]; then
    echo "⚠️  Warning: .env file not found!"
    echo "Please copy .env.example to .env and configure it."
    exit 1
fi

# Function to cleanup processes on exit
cleanup() {
    echo ""
    echo "🛑 Shutting down..."
    kill $API_PID $WORKER_PID 2>/dev/null
    exit 0
}

trap cleanup SIGINT SIGTERM

# Start the API server in the background
echo "📡 Starting API server..."
npm run watch &
API_PID=$!

# Give the API a moment to start
sleep 2

# Start the AI jobs worker in the background
echo "🤖 Starting AI jobs worker..."
npm run worker:dev &
WORKER_PID=$!

echo ""
echo "✅ Both services are running:"
echo "   - API Server (PID: $API_PID)"
echo "   - AI Worker  (PID: $WORKER_PID)"
echo ""
echo "Press Ctrl+C to stop both services"
echo ""

# Wait for both processes
wait
