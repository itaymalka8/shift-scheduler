#!/bin/bash

# Database Setup Script
# This script sets up the PostgreSQL database

echo "🗄️  Setting up Shift Scheduler Database..."
echo "=========================================="
echo ""

# Check if PostgreSQL is installed
if ! command -v psql &> /dev/null; then
    echo "❌ PostgreSQL is not installed. Please install PostgreSQL first."
    echo "   Visit: https://www.postgresql.org/download/"
    exit 1
fi

echo "✅ PostgreSQL is installed"
echo ""

# Check if PostgreSQL service is running
if ! pg_isready -h localhost -p 5432 &> /dev/null; then
    echo "❌ PostgreSQL service is not running. Please start PostgreSQL first."
    echo "   On Windows: Start PostgreSQL service"
    echo "   On Linux/Mac: sudo service postgresql start"
    exit 1
fi

echo "✅ PostgreSQL service is running"
echo ""

# Create database if it doesn't exist
echo "🔨 Creating database 'shift_scheduler'..."
createdb -h localhost -U postgres shift_scheduler 2>/dev/null || echo "Database might already exist"

# Test connection
echo "🔍 Testing database connection..."
if psql -h localhost -U postgres -d shift_scheduler -c "SELECT 1;" &> /dev/null; then
    echo "✅ Database connection successful!"
else
    echo "❌ Database connection failed. Please check your PostgreSQL setup."
    exit 1
fi

echo ""
echo "🎉 Database setup completed successfully!"
echo ""
echo "📊 Database Information:"
echo "   Host: localhost"
echo "   Port: 5432"
echo "   Database: shift_scheduler"
echo "   Username: postgres"
echo "   Password: (your PostgreSQL password)"
echo ""
echo "🔧 Next Steps:"
echo "   1. Run the backend: cd backend && npm run dev"
echo "   2. The database will be initialized automatically"
echo "   3. Or run manually: node backend/database/init.js"
echo ""

