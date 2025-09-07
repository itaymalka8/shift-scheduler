#!/bin/bash

# Full Stack Start Script
# This script starts both frontend and backend

echo "🚀 Starting Shift Scheduler Full Stack..."
echo "========================================="
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

# Install frontend dependencies
if [ ! -d "node_modules" ]; then
    echo "📦 Installing frontend dependencies..."
    npm install
    echo "✅ Frontend dependencies installed!"
    echo ""
fi

# Install backend dependencies
if [ ! -d "backend/node_modules" ]; then
    echo "📦 Installing backend dependencies..."
    cd backend
    npm install
    cd ..
    echo "✅ Backend dependencies installed!"
    echo ""
fi

# Check if PostgreSQL is running
echo "🔍 Checking PostgreSQL connection..."
if command -v psql &> /dev/null; then
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
fi

echo ""
echo "🚀 Starting services..."
echo ""

# Start backend in background
echo "🔧 Starting backend server..."
cd backend
npm run dev &
BACKEND_PID=$!
cd ..

# Wait a moment for backend to start
sleep 5

# Start frontend
echo "🌐 Starting frontend server..."
echo ""
echo "📱 Application URLs:"
echo "   Frontend: http://localhost:3000"
echo "   Backend API: http://localhost:5000/api"
echo "   Health Check: http://localhost:5000/api/health"
echo ""
echo "👤 Default Admin Login:"
echo "   Username: itaymalka8"
echo "   Password: 1990"
echo ""
echo "Press Ctrl+C to stop both services"
echo ""

# Start frontend
npm run dev

# Cleanup function
cleanup() {
    echo ""
    echo "🛑 Stopping services..."
    kill $BACKEND_PID 2>/dev/null
    echo "✅ Services stopped"
    exit 0
}

# Set trap for cleanup
trap cleanup SIGINT SIGTERM

