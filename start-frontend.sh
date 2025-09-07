#!/bin/bash

# Frontend Quick Start Script
# This script starts the frontend development server

echo "🌐 Starting Shift Scheduler Frontend..."
echo "======================================="
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Please run this script from the shift-scheduler directory"
    echo "   Current directory: $(pwd)"
    echo "   Expected: shift-scheduler/"
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

# Check if backend is running
echo "🔍 Checking backend connection..."
if curl -f http://localhost:5000/api/health &> /dev/null; then
    echo "✅ Backend is running!"
else
    echo "⚠️  Backend is not running. Please start the backend first:"
    echo "   cd backend && npm run dev"
    echo ""
    echo "   Or run: ./backend/start.sh"
    echo ""
fi

echo "🚀 Starting frontend server..."
echo "   Frontend URL: http://localhost:3000"
echo "   Backend API: http://localhost:5000/api"
echo ""

# Start the server
npm run dev

