#!/bin/bash

# Reset Script
# This script resets the application to a clean state

echo "🔄 Resetting Shift Scheduler..."
echo "==============================="
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

# Confirm reset
echo "⚠️  This will reset the application to a clean state."
echo "   This will remove all dependencies and build artifacts."
echo "   The source code will remain intact."
echo ""
read -p "Are you sure you want to continue? (y/N): " confirm

if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
    echo "❌ Reset cancelled"
    exit 0
fi

echo ""
echo "🔄 Starting reset..."

# Stop any running services
echo "🛑 Stopping running services..."
pkill -f "npm run dev" 2>/dev/null || true
pkill -f "node server.js" 2>/dev/null || true

# Remove frontend dependencies
echo "🧹 Removing frontend dependencies..."
if [ -d "node_modules" ]; then
    rm -rf node_modules
    echo "✅ Frontend node_modules removed"
fi

if [ -d ".next" ]; then
    rm -rf .next
    echo "✅ Frontend .next directory removed"
fi

if [ -d "out" ]; then
    rm -rf out
    echo "✅ Frontend out directory removed"
fi

# Remove backend dependencies
echo "🧹 Removing backend dependencies..."
if [ -d "backend/node_modules" ]; then
    rm -rf backend/node_modules
    echo "✅ Backend node_modules removed"
fi

if [ -d "backend/dist" ]; then
    rm -rf backend/dist
    echo "✅ Backend dist directory removed"
fi

# Remove environment files
echo "🧹 Removing environment files..."
if [ -f ".env.local" ]; then
    rm -f .env.local
    echo "✅ Frontend .env.local removed"
fi

if [ -f "backend/.env" ]; then
    rm -f backend/.env
    echo "✅ Backend .env removed"
fi

# Remove Docker containers and images
echo "🧹 Removing Docker containers and images..."
if command -v docker &> /dev/null; then
    docker-compose down 2>/dev/null || true
    docker system prune -f
    echo "✅ Docker cleanup completed"
else
    echo "⚠️  Docker not found, skipping Docker cleanup"
fi

# Remove backup files
echo "🧹 Removing backup files..."
if ls backup-*.tar.gz 1> /dev/null 2>&1; then
    rm -f backup-*.tar.gz
    echo "✅ Backup files removed"
fi

if ls backup-*.zip 1> /dev/null 2>&1; then
    rm -f backup-*.zip
    echo "✅ Backup files removed"
fi

echo ""

# Reinstall dependencies
echo "📦 Reinstalling dependencies..."

# Frontend
echo "📦 Installing frontend dependencies..."
npm install
if [ $? -eq 0 ]; then
    echo "✅ Frontend dependencies installed"
else
    echo "❌ Failed to install frontend dependencies"
    exit 1
fi

# Backend
echo "📦 Installing backend dependencies..."
cd backend
npm install
if [ $? -eq 0 ]; then
    echo "✅ Backend dependencies installed"
else
    echo "❌ Failed to install backend dependencies"
    exit 1
fi
cd ..

echo ""

# Rebuild frontend
echo "🔨 Rebuilding frontend..."
npm run build
if [ $? -eq 0 ]; then
    echo "✅ Frontend rebuilt successfully"
else
    echo "❌ Frontend rebuild failed"
    exit 1
fi

echo ""

# Final reset
echo "🎉 Reset completed successfully!"
echo ""
echo "📊 Reset Summary:"
echo "================="
echo "   Frontend: Dependencies removed and reinstalled"
echo "   Backend: Dependencies removed and reinstalled"
echo "   Environment: Configuration files removed"
echo "   Docker: Containers and images removed"
echo "   Backups: Backup files removed"
echo ""
echo "🚀 Next Steps:"
echo "=============="
echo "   1. Start the application:"
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