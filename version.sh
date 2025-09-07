#!/bin/bash

# Version Script
# This script shows version information

echo "📋 Shift Scheduler - Version Information"
echo "========================================"
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

# Frontend Version
echo "🌐 Frontend Version:"
echo "==================="
if [ -f "package.json" ]; then
    FRONTEND_VERSION=$(grep '"version"' package.json | cut -d'"' -f4)
    echo "   Version: $FRONTEND_VERSION"
    
    # Check if node_modules exists
    if [ -d "node_modules" ]; then
        echo "   Dependencies: Installed"
    else
        echo "   Dependencies: Not installed"
    fi
    
    # Check if .next exists
    if [ -d ".next" ]; then
        echo "   Build: Built"
    else
        echo "   Build: Not built"
    fi
else
    echo "   ❌ package.json not found"
fi

echo ""

# Backend Version
echo "🔧 Backend Version:"
echo "=================="
if [ -f "backend/package.json" ]; then
    BACKEND_VERSION=$(grep '"version"' backend/package.json | cut -d'"' -f4)
    echo "   Version: $BACKEND_VERSION"
    
    # Check if node_modules exists
    if [ -d "backend/node_modules" ]; then
        echo "   Dependencies: Installed"
    else
        echo "   Dependencies: Not installed"
    fi
    
    # Check if server.js exists
    if [ -f "backend/server.js" ]; then
        echo "   Server: Available"
    else
        echo "   Server: Not available"
    fi
else
    echo "   ❌ backend/package.json not found"
fi

echo ""

# System Versions
echo "💻 System Versions:"
echo "=================="

# Node.js
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo "   Node.js: $NODE_VERSION"
else
    echo "   Node.js: Not installed"
fi

# npm
if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm --version)
    echo "   npm: $NPM_VERSION"
else
    echo "   npm: Not installed"
fi

# PostgreSQL
if command -v psql &> /dev/null; then
    PSQL_VERSION=$(psql --version | cut -d' ' -f3)
    echo "   PostgreSQL: $PSQL_VERSION"
else
    echo "   PostgreSQL: Not installed"
fi

# Docker
if command -v docker &> /dev/null; then
    DOCKER_VERSION=$(docker --version | cut -d' ' -f3 | cut -d',' -f1)
    echo "   Docker: $DOCKER_VERSION"
else
    echo "   Docker: Not installed"
fi

# Docker Compose
if command -v docker-compose &> /dev/null; then
    COMPOSE_VERSION=$(docker-compose --version | cut -d' ' -f3 | cut -d',' -f1)
    echo "   Docker Compose: $COMPOSE_VERSION"
else
    echo "   Docker Compose: Not installed"
fi

echo ""

# Git Information
echo "📝 Git Information:"
echo "==================="
if command -v git &> /dev/null && [ -d ".git" ]; then
    GIT_BRANCH=$(git branch --show-current 2>/dev/null || echo "Unknown")
    GIT_COMMIT=$(git rev-parse HEAD 2>/dev/null | cut -c1-8 || echo "Unknown")
    GIT_TAG=$(git describe --tags 2>/dev/null || echo "No tags")
    
    echo "   Branch: $GIT_BRANCH"
    echo "   Commit: $GIT_COMMIT"
    echo "   Tag: $GIT_TAG"
else
    echo "   Git: Not available or not a git repository"
fi

echo ""

# Build Information
echo "🔨 Build Information:"
echo "====================="
if [ -d ".next" ]; then
    echo "   Frontend: Built"
    if [ -f ".next/BUILD_ID" ]; then
        BUILD_ID=$(cat .next/BUILD_ID)
        echo "   Build ID: $BUILD_ID"
    fi
else
    echo "   Frontend: Not built"
fi

if [ -d "backend/dist" ]; then
    echo "   Backend: Built"
else
    echo "   Backend: Not built"
fi

echo ""

# Environment Information
echo "🌍 Environment Information:"
echo "=========================="
echo "   OS: $(uname -s)"
echo "   Architecture: $(uname -m)"
echo "   Shell: $SHELL"
echo "   User: $USER"
echo "   Home: $HOME"
echo ""

# Memory Information
echo "🧠 Memory Information:"
echo "======================"
if command -v free &> /dev/null; then
    TOTAL_MEM=$(free -h | grep Mem | awk '{print $2}')
    USED_MEM=$(free -h | grep Mem | awk '{print $3}')
    FREE_MEM=$(free -h | grep Mem | awk '{print $4}')
    
    echo "   Total: $TOTAL_MEM"
    echo "   Used: $USED_MEM"
    echo "   Free: $FREE_MEM"
else
    echo "   Memory info: Not available"
fi

echo ""

# Disk Information
echo "💾 Disk Information:"
echo "===================="
if command -v df &> /dev/null; then
    DISK_USAGE=$(df -h . | awk 'NR==2 {print $5}')
    DISK_AVAILABLE=$(df -h . | awk 'NR==2 {print $4}')
    
    echo "   Usage: $DISK_USAGE"
    echo "   Available: $DISK_AVAILABLE"
else
    echo "   Disk info: Not available"
fi

echo ""

# Network Information
echo "🌐 Network Information:"
echo "======================="
if command -v curl &> /dev/null; then
    echo "   curl: Available"
else
    echo "   curl: Not available"
fi

if command -v wget &> /dev/null; then
    echo "   wget: Available"
else
    echo "   wget: Not available"
fi

echo ""

# Service Status
echo "🔍 Service Status:"
echo "=================="

# Check Frontend
if curl -f http://localhost:3000 &> /dev/null; then
    echo "   Frontend: Running on http://localhost:3000"
else
    echo "   Frontend: Not running"
fi

# Check Backend
if curl -f http://localhost:5000/api/health &> /dev/null; then
    echo "   Backend: Running on http://localhost:5000/api"
else
    echo "   Backend: Not running"
fi

# Check Database
if nc -z localhost 5432 &> /dev/null; then
    echo "   Database: Running on localhost:5432"
else
    echo "   Database: Not running"
fi

echo ""
echo "🎉 Version check completed!"
echo ""