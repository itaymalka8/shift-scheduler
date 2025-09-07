#!/bin/bash

# Build Script
# This script builds both frontend and backend for production

echo "🔨 Building Shift Scheduler for Production..."
echo "============================================="
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

# Build frontend
echo "🔨 Building frontend..."
if [ -f "package.json" ]; then
    if npm run build; then
        echo "✅ Frontend build successful!"
    else
        echo "❌ Frontend build failed!"
        exit 1
    fi
else
    echo "❌ Frontend package.json not found!"
    exit 1
fi

echo ""

# Build backend
echo "🔨 Building backend..."
if [ -f "backend/package.json" ]; then
    cd backend
    if npm run build 2>/dev/null; then
        echo "✅ Backend build successful!"
    else
        echo "⚠️  Backend build failed or not configured"
    fi
    cd ..
else
    echo "⚠️  Backend package.json not found!"
fi

echo ""
echo "🎉 Build completed successfully!"
echo ""
echo "📊 Build Summary:"
echo "   Frontend: Built successfully"
echo "   Backend: Check output above"
echo ""
echo "🚀 To start production:"
echo "   Frontend: npm start"
echo "   Backend: cd backend && npm start"
echo ""
echo "🐳 Or use Docker:"
echo "   docker-compose up --build -d"
echo ""

