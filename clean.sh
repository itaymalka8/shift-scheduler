#!/bin/bash

# Clean Script
# This script cleans build artifacts and dependencies

echo "🧹 Cleaning Shift Scheduler..."
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

# Clean frontend
echo "🧹 Cleaning frontend..."
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

echo ""

# Clean backend
echo "🧹 Cleaning backend..."
if [ -d "backend/node_modules" ]; then
    rm -rf backend/node_modules
    echo "✅ Backend node_modules removed"
fi

if [ -d "backend/dist" ]; then
    rm -rf backend/dist
    echo "✅ Backend dist directory removed"
fi

echo ""

# Clean Docker
echo "🧹 Cleaning Docker..."
if command -v docker &> /dev/null; then
    docker system prune -f
    echo "✅ Docker cleanup completed"
else
    echo "⚠️  Docker not found, skipping Docker cleanup"
fi

echo ""
echo "🎉 Clean completed successfully!"
echo ""
echo "📊 Clean Summary:"
echo "   Frontend: node_modules, .next, out removed"
echo "   Backend: node_modules, dist removed"
echo "   Docker: system cleanup completed"
echo ""
echo "🔧 To reinstall dependencies:"
echo "   Frontend: npm install"
echo "   Backend: cd backend && npm install"
echo ""

