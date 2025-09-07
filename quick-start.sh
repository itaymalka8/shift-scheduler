#!/bin/bash

# Quick Start Script
# This script provides a quick way to start the Shift Scheduler application

echo "🚀 Quick Start - Shift Scheduler"
echo "================================="
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

# Check if application is already installed
if [ ! -d "node_modules" ] || [ ! -d "backend/node_modules" ]; then
    echo "📦 Application not installed. Installing..."
    ./install.sh
    if [ $? -ne 0 ]; then
        echo "❌ Installation failed"
        exit 1
    fi
    echo ""
fi

# Check if database is set up
if command -v psql &> /dev/null; then
    if ! psql -h localhost -U postgres -d shift_scheduler -c "SELECT 1;" &> /dev/null; then
        echo "🗄️  Database not set up. Setting up..."
        ./setup-database.sh
        if [ $? -ne 0 ]; then
            echo "❌ Database setup failed"
            exit 1
        fi
        echo ""
    fi
fi

# Start the application
echo "🚀 Starting Shift Scheduler..."
echo ""

# Check if Docker is available
if command -v docker &> /dev/null && docker ps &> /dev/null; then
    echo "🐳 Starting with Docker..."
    ./start-docker.sh
else
    echo "📱 Starting with npm..."
    ./start-all.sh
fi

echo ""
echo "🎉 Shift Scheduler is starting!"
echo ""
echo "📱 Application URLs:"
echo "==================="
echo "   Frontend: http://localhost:3000"
echo "   Backend API: http://localhost:5000/api"
echo "   Health Check: http://localhost:5000/api/health"
echo ""
echo "👤 Default Admin Login:"
echo "====================="
echo "   Username: itaymalka8"
echo "   Password: 1990"
echo ""
echo "🔧 Management Commands:"
echo "======================"
echo "   Check status: ./status.sh"
echo "   View logs: ./logs.sh"
echo "   Monitor: ./monitor.sh"
echo "   Stop: ./stop-all.sh"
echo ""
echo "🎉 Happy coding!"
echo ""