#!/bin/bash

# Logs Script
# This script shows logs for all services

echo "📋 Shift Scheduler Logs..."
echo "=========================="
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

# Check if Docker is running
if command -v docker &> /dev/null && docker info &> /dev/null; then
    echo "🐳 Docker services detected!"
    echo ""
    echo "📋 Docker service logs:"
    echo "======================"
    docker-compose logs --tail=50
    echo ""
    echo "🔍 To follow logs in real-time:"
    echo "   docker-compose logs -f"
    echo ""
    echo "🔍 To view specific service logs:"
    echo "   docker-compose logs -f frontend"
    echo "   docker-compose logs -f backend"
    echo "   docker-compose logs -f postgres"
    echo ""
else
    echo "🔧 Manual services detected!"
    echo ""
    echo "📋 Manual service logs:"
    echo "====================="
    
    # Check if services are running
    if pgrep -f "npm run dev" > /dev/null; then
        echo "✅ Frontend service is running"
    else
        echo "❌ Frontend service is not running"
    fi
    
    if pgrep -f "node server.js" > /dev/null; then
        echo "✅ Backend service is running"
    else
        echo "❌ Backend service is not running"
    fi
    
    if pgrep -f "postgres" > /dev/null; then
        echo "✅ PostgreSQL service is running"
    else
        echo "❌ PostgreSQL service is not running"
    fi
    
    echo ""
    echo "🔍 To view logs:"
    echo "   Frontend: Check terminal where 'npm run dev' is running"
    echo "   Backend: Check terminal where 'cd backend && npm run dev' is running"
    echo "   PostgreSQL: Check system logs"
    echo ""
fi

echo "📊 Log locations:"
echo "================="
echo "   Frontend: Terminal output"
echo "   Backend: Terminal output"
echo "   Database: System logs"
echo "   Docker: docker-compose logs -f"
echo ""
echo "🔧 Useful log commands:"
echo "======================"
echo "   docker-compose logs -f                    - Follow all logs"
echo "   docker-compose logs -f --tail=100         - Show last 100 lines"
echo "   docker-compose logs -f frontend           - Frontend logs only"
echo "   docker-compose logs -f backend            - Backend logs only"
echo "   docker-compose logs -f postgres           - Database logs only"
echo ""