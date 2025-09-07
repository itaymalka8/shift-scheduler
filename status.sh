#!/bin/bash

# Status Script
# This script checks the status of all services

echo "📊 Shift Scheduler Status Check..."
echo "=================================="
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

# Check Node.js
echo "🔍 Checking Node.js..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo "✅ Node.js: $NODE_VERSION"
else
    echo "❌ Node.js not found"
fi

# Check npm
echo "🔍 Checking npm..."
if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm --version)
    echo "✅ npm: $NPM_VERSION"
else
    echo "❌ npm not found"
fi

# Check PostgreSQL
echo "🔍 Checking PostgreSQL..."
if command -v psql &> /dev/null; then
    PSQL_VERSION=$(psql --version | cut -d' ' -f3)
    echo "✅ PostgreSQL: $PSQL_VERSION"
    
    # Check if PostgreSQL is running
    if pg_isready -h localhost -p 5432 &> /dev/null; then
        echo "✅ PostgreSQL service: Running"
    else
        echo "❌ PostgreSQL service: Not running"
    fi
else
    echo "❌ PostgreSQL not found"
fi

# Check Docker
echo "🔍 Checking Docker..."
if command -v docker &> /dev/null; then
    DOCKER_VERSION=$(docker --version | cut -d' ' -f3 | cut -d',' -f1)
    echo "✅ Docker: $DOCKER_VERSION"
    
    # Check if Docker is running
    if docker info &> /dev/null; then
        echo "✅ Docker service: Running"
    else
        echo "❌ Docker service: Not running"
    fi
else
    echo "❌ Docker not found"
fi

# Check Docker Compose
echo "🔍 Checking Docker Compose..."
if command -v docker-compose &> /dev/null; then
    COMPOSE_VERSION=$(docker-compose --version | cut -d' ' -f3 | cut -d',' -f1)
    echo "✅ Docker Compose: $COMPOSE_VERSION"
else
    echo "❌ Docker Compose not found"
fi

echo ""

# Check Frontend
echo "🔍 Checking Frontend..."
if [ -d "node_modules" ]; then
    echo "✅ Frontend dependencies: Installed"
else
    echo "❌ Frontend dependencies: Not installed"
fi

if [ -d ".next" ]; then
    echo "✅ Frontend build: Built"
else
    echo "❌ Frontend build: Not built"
fi

# Check Backend
echo "🔍 Checking Backend..."
if [ -d "backend/node_modules" ]; then
    echo "✅ Backend dependencies: Installed"
else
    echo "❌ Backend dependencies: Not installed"
fi

if [ -f "backend/server.js" ]; then
    echo "✅ Backend server: Found"
else
    echo "❌ Backend server: Not found"
fi

echo ""

# Check running services
echo "🔍 Checking running services..."

# Check Frontend (port 3000)
if curl -f http://localhost:3000 &> /dev/null; then
    echo "✅ Frontend: Running on http://localhost:3000"
else
    echo "❌ Frontend: Not running"
fi

# Check Backend (port 5000)
if curl -f http://localhost:5000/api/health &> /dev/null; then
    echo "✅ Backend: Running on http://localhost:5000/api"
else
    echo "❌ Backend: Not running"
fi

# Check Database (port 5432)
if nc -z localhost 5432 &> /dev/null; then
    echo "✅ Database: Running on localhost:5432"
else
    echo "❌ Database: Not running"
fi

echo ""
echo "📊 Status Summary:"
echo "   Node.js: Check above"
echo "   npm: Check above"
echo "   PostgreSQL: Check above"
echo "   Docker: Check above"
echo "   Frontend: Check above"
echo "   Backend: Check above"
echo "   Database: Check above"
echo ""
echo "🔧 Quick Commands:"
echo "   Start all: ./start-all.sh"
echo "   Start Docker: ./start-docker.sh"
echo "   Setup database: ./setup-database.sh"
echo "   Clean: ./clean.sh"
echo ""

