#!/bin/bash

# Uninstall Script
# This script removes the Shift Scheduler application

echo "🗑️  Uninstalling Shift Scheduler..."
echo "===================================="
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

# Confirm uninstall
echo "⚠️  This will remove the Shift Scheduler application and all its data."
echo "   This action cannot be undone!"
echo ""
read -p "Are you sure you want to continue? (y/N): " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Uninstall cancelled"
    exit 0
fi

echo ""

# Stop all services
echo "🛑 Stopping all services..."
if [ -f "stop-all.sh" ]; then
    ./stop-all.sh
    echo "✅ All services stopped"
else
    echo "⚠️  stop-all.sh not found, skipping service stop"
fi

echo ""

# Remove frontend dependencies
echo "🗑️  Removing frontend dependencies..."
if [ -d "node_modules" ]; then
    rm -rf node_modules
    echo "✅ Frontend node_modules removed"
else
    echo "⚠️  Frontend node_modules not found"
fi

if [ -d ".next" ]; then
    rm -rf .next
    echo "✅ Frontend build files removed"
else
    echo "⚠️  Frontend build files not found"
fi

echo ""

# Remove backend dependencies
echo "🗑️  Removing backend dependencies..."
if [ -d "backend/node_modules" ]; then
    rm -rf backend/node_modules
    echo "✅ Backend node_modules removed"
else
    echo "⚠️  Backend node_modules not found"
fi

echo ""

# Remove environment files
echo "🗑️  Removing environment files..."
if [ -f ".env.local" ]; then
    rm .env.local
    echo "✅ Frontend .env.local removed"
else
    echo "⚠️  Frontend .env.local not found"
fi

if [ -f "backend/.env" ]; then
    rm backend/.env
    echo "✅ Backend .env removed"
else
    echo "⚠️  Backend .env not found"
fi

echo ""

# Remove Docker containers and images
echo "🗑️  Removing Docker containers and images..."
if command -v docker &> /dev/null; then
    # Stop and remove containers
    docker-compose down --volumes --remove-orphans 2>/dev/null || echo "No Docker containers to remove"
    
    # Remove images
    docker rmi shift-scheduler-frontend 2>/dev/null || echo "Frontend image not found"
    docker rmi shift-scheduler-backend 2>/dev/null || echo "Backend image not found"
    docker rmi postgres:15 2>/dev/null || echo "PostgreSQL image not found"
    
    echo "✅ Docker containers and images removed"
else
    echo "⚠️  Docker not found, skipping Docker cleanup"
fi

echo ""

# Remove database (optional)
echo "🗑️  Removing database..."
if command -v psql &> /dev/null; then
    read -p "Do you want to remove the database? (y/N): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        dropdb -h localhost -U postgres shift_scheduler 2>/dev/null || echo "Database might not exist"
        echo "✅ Database removed"
    else
        echo "⚠️  Database kept"
    fi
else
    echo "⚠️  PostgreSQL not found, skipping database removal"
fi

echo ""

# Remove logs
echo "🗑️  Removing logs..."
if [ -d "logs" ]; then
    rm -rf logs
    echo "✅ Logs removed"
else
    echo "⚠️  Logs directory not found"
fi

echo ""

# Remove backups
echo "🗑️  Removing backups..."
if [ -d "backups" ]; then
    rm -rf backups
    echo "✅ Backups removed"
else
    echo "⚠️  Backups directory not found"
fi

echo ""

# Remove temporary files
echo "🗑️  Removing temporary files..."
if [ -d "tmp" ]; then
    rm -rf tmp
    echo "✅ Temporary files removed"
else
    echo "⚠️  Temporary files not found"
fi

echo ""

# Final cleanup
echo "🎉 Uninstall completed successfully!"
echo ""
echo "📊 Uninstall Summary:"
echo "====================="
echo "   Frontend: Dependencies and build files removed"
echo "   Backend: Dependencies removed"
echo "   Docker: Containers and images removed"
echo "   Database: Removed (if confirmed)"
echo "   Environment: Configuration files removed"
echo "   Logs: Removed"
echo "   Backups: Removed"
echo "   Temporary: Files removed"
echo ""
echo "📁 Remaining files:"
echo "==================="
echo "   Source code: Kept"
echo "   Scripts: Kept"
echo "   Documentation: Kept"
echo ""
echo "🔄 To reinstall:"
echo "==============="
echo "   ./install.sh"
echo ""
echo "🎉 Thank you for using Shift Scheduler!"
echo ""