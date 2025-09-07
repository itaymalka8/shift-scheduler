#!/bin/bash

# Health Check Script
# This script performs a comprehensive health check

echo "🏥 Shift Scheduler Health Check..."
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

# Health check results
FRONTEND_HEALTH=0
BACKEND_HEALTH=0
DATABASE_HEALTH=0
DOCKER_HEALTH=0
OVERALL_HEALTH=0

# Check Frontend
echo "🌐 Checking Frontend..."
if curl -f http://localhost:3000 &> /dev/null; then
    echo "✅ Frontend: Healthy"
    FRONTEND_HEALTH=1
else
    echo "❌ Frontend: Unhealthy"
fi

# Check Backend
echo "🔧 Checking Backend..."
if curl -f http://localhost:5000/api/health &> /dev/null; then
    echo "✅ Backend: Healthy"
    BACKEND_HEALTH=1
else
    echo "❌ Backend: Unhealthy"
fi

# Check Database
echo "🗄️  Checking Database..."
if nc -z localhost 5432 &> /dev/null; then
    echo "✅ Database: Healthy"
    DATABASE_HEALTH=1
else
    echo "❌ Database: Unhealthy"
fi

# Check Docker
echo "🐳 Checking Docker..."
if command -v docker &> /dev/null && docker info &> /dev/null; then
    echo "✅ Docker: Healthy"
    DOCKER_HEALTH=1
else
    echo "❌ Docker: Unhealthy"
fi

echo ""

# Calculate overall health
TOTAL_CHECKS=4
HEALTHY_CHECKS=$((FRONTEND_HEALTH + BACKEND_HEALTH + DATABASE_HEALTH + DOCKER_HEALTH))
HEALTH_PERCENTAGE=$((HEALTHY_CHECKS * 100 / TOTAL_CHECKS))

echo "📊 Health Summary:"
echo "=================="
echo "   Frontend: $([ $FRONTEND_HEALTH -eq 1 ] && echo "✅ Healthy" || echo "❌ Unhealthy")"
echo "   Backend: $([ $BACKEND_HEALTH -eq 1 ] && echo "✅ Healthy" || echo "❌ Unhealthy")"
echo "   Database: $([ $DATABASE_HEALTH -eq 1 ] && echo "✅ Healthy" || echo "❌ Unhealthy")"
echo "   Docker: $([ $DOCKER_HEALTH -eq 1 ] && echo "✅ Healthy" || echo "❌ Unhealthy")"
echo ""
echo "🏥 Overall Health: $HEALTH_PERCENTAGE% ($HEALTHY_CHECKS/$TOTAL_CHECKS services healthy)"

# Determine health status
if [ $HEALTH_PERCENTAGE -eq 100 ]; then
    echo "🎉 All services are healthy!"
    OVERALL_HEALTH=1
elif [ $HEALTH_PERCENTAGE -ge 75 ]; then
    echo "⚠️  Most services are healthy, but some issues detected"
elif [ $HEALTH_PERCENTAGE -ge 50 ]; then
    echo "⚠️  Some services are healthy, but significant issues detected"
else
    echo "❌ Critical issues detected, immediate attention required"
fi

echo ""

# Recommendations
echo "🔧 Recommendations:"
echo "==================="

if [ $FRONTEND_HEALTH -eq 0 ]; then
    echo "   • Start frontend: npm run dev"
fi

if [ $BACKEND_HEALTH -eq 0 ]; then
    echo "   • Start backend: cd backend && npm run dev"
fi

if [ $DATABASE_HEALTH -eq 0 ]; then
    echo "   • Start PostgreSQL service"
    echo "   • Check database connection settings"
fi

if [ $DOCKER_HEALTH -eq 0 ]; then
    echo "   • Start Docker service"
    echo "   • Check Docker installation"
fi

if [ $OVERALL_HEALTH -eq 1 ]; then
    echo "   • All services are running properly"
    echo "   • No immediate action required"
fi

echo ""

# Quick fixes
echo "🚀 Quick Fixes:"
echo "==============="
echo "   • Start all services: ./start-all.sh"
echo "   • Start with Docker: ./start-docker.sh"
echo "   • Check status: ./status.sh"
echo "   • View logs: ./logs.sh"
echo "   • Monitor: ./monitor.sh"
echo ""

# Exit with appropriate code
if [ $OVERALL_HEALTH -eq 1 ]; then
    exit 0
else
    exit 1
fi