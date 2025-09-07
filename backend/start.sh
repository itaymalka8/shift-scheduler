#!/bin/bash

# Backend Quick Start Script
# This script starts the backend server with database setup

echo "🔧 Starting Shift Scheduler Backend..."
echo "====================================="
echo ""

# Check if we're in the backend directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Please run this script from the backend directory"
    echo "   Current directory: $(pwd)"
    echo "   Expected: backend/"
    exit 1
fi

echo "📁 Current directory: $(pwd)"
echo ""

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    echo "✅ Dependencies installed!"
    echo ""
fi

# Check if PostgreSQL is running
echo "🔍 Checking PostgreSQL connection..."
if command -v psql &> /dev/null; then
    # Try to connect to PostgreSQL
    if psql -h localhost -U postgres -d shift_scheduler -c "SELECT 1;" &> /dev/null; then
        echo "✅ PostgreSQL connection successful!"
    else
        echo "⚠️  PostgreSQL connection failed. Please ensure:"
        echo "   - PostgreSQL is installed and running"
        echo "   - Database 'shift_scheduler' exists"
        echo "   - User 'postgres' has access"
        echo ""
        echo "Creating database if it doesn't exist..."
        createdb -h localhost -U postgres shift_scheduler 2>/dev/null || echo "Database might already exist"
    fi
else
    echo "⚠️  PostgreSQL client not found. Please install PostgreSQL"
    echo "   The server will start but database operations will fail"
fi

echo ""
echo "🚀 Starting backend server..."
echo "   API URL: http://localhost:5000/api"
echo "   Health Check: http://localhost:5000/api/health"
echo ""

# Start the server
npm run dev

