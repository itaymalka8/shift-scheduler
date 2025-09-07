#!/bin/bash

# Update Script
# This script updates the application

echo "🔄 Updating Shift Scheduler..."
echo "=============================="
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

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    echo "   Visit: https://nodejs.org/"
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

echo "✅ Node.js and npm are installed"
echo ""

# Update frontend dependencies
echo "🔄 Updating frontend dependencies..."
if [ -f "package.json" ]; then
    npm update
    if [ $? -eq 0 ]; then
        echo "✅ Frontend dependencies updated"
    else
        echo "❌ Failed to update frontend dependencies"
        exit 1
    fi
else
    echo "❌ Frontend package.json not found"
    exit 1
fi

echo ""

# Update backend dependencies
echo "🔄 Updating backend dependencies..."
if [ -f "backend/package.json" ]; then
    cd backend
    npm update
    if [ $? -eq 0 ]; then
        echo "✅ Backend dependencies updated"
    else
        echo "❌ Failed to update backend dependencies"
        exit 1
    fi
    cd ..
else
    echo "❌ Backend package.json not found"
    exit 1
fi

echo ""

# Rebuild frontend
echo "🔨 Rebuilding frontend..."
if [ -f "package.json" ]; then
    npm run build
    if [ $? -eq 0 ]; then
        echo "✅ Frontend rebuilt successfully"
    else
        echo "❌ Frontend rebuild failed"
        exit 1
    fi
else
    echo "❌ Frontend package.json not found"
    exit 1
fi

echo ""

# Rebuild backend
echo "🔨 Rebuilding backend..."
if [ -f "backend/package.json" ]; then
    cd backend
    if npm run build 2>/dev/null; then
        echo "✅ Backend rebuilt successfully"
    else
        echo "⚠️  Backend rebuild failed or not configured"
    fi
    cd ..
else
    echo "❌ Backend package.json not found"
fi

echo ""

# Update Docker images
echo "🐳 Updating Docker images..."
if command -v docker &> /dev/null; then
    docker-compose pull
    if [ $? -eq 0 ]; then
        echo "✅ Docker images updated"
    else
        echo "⚠️  Failed to update Docker images"
    fi
else
    echo "⚠️  Docker not found, skipping Docker update"
fi

echo ""

# Final update
echo "🎉 Update completed successfully!"
echo ""
echo "📊 Update Summary:"
echo "=================="
echo "   Frontend: Dependencies updated and rebuilt"
echo "   Backend: Dependencies updated and rebuilt"
echo "   Docker: Images updated"
echo ""
echo "🚀 Next Steps:"
echo "=============="
echo "   1. Restart the application:"
echo "      ./start-all.sh"
echo "      Or: ./start-docker.sh"
echo ""
echo "   2. Check status:"
echo "      ./status.sh"
echo ""
echo "   3. View logs:"
echo "      ./logs.sh"
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
echo "🎉 Happy coding!"
echo ""