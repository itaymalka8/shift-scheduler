#!/bin/bash

# Docker Quick Start Script
# This script starts the application using Docker

echo "🐳 Starting Shift Scheduler with Docker..."
echo "=========================================="
echo ""

# Check if we're in the right directory
if [ ! -f "docker-compose.yml" ]; then
    echo "❌ Error: Please run this script from the shift-scheduler directory"
    echo "   Current directory: $(pwd)"
    echo "   Expected: shift-scheduler/"
    exit 1
fi

echo "📁 Current directory: $(pwd)"
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    echo "   Visit: https://docs.docker.com/get-docker/"
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    echo "   Visit: https://docs.docker.com/compose/install/"
    exit 1
fi

echo "✅ Docker and Docker Compose are installed"
echo ""

# Stop existing containers
echo "🛑 Stopping existing containers..."
docker-compose down

# Remove old images (optional)
echo "🧹 Cleaning up old images..."
docker system prune -f

# Build and start services
echo "🔨 Building and starting services..."
docker-compose up --build -d

# Wait for services to be ready
echo "⏳ Waiting for services to be ready..."
sleep 30

# Check if services are running
echo "🔍 Checking service status..."
docker-compose ps

# Test API health
echo "🏥 Testing API health..."
if curl -f http://localhost:5000/api/health > /dev/null 2>&1; then
    echo "✅ Backend API is healthy"
else
    echo "❌ Backend API is not responding"
    echo "   Check logs: docker-compose logs backend"
    exit 1
fi

# Test Frontend
echo "🌐 Testing Frontend..."
if curl -f http://localhost:3000 > /dev/null 2>&1; then
    echo "✅ Frontend is healthy"
else
    echo "❌ Frontend is not responding"
    echo "   Check logs: docker-compose logs frontend"
    exit 1
fi

echo ""
echo "🎉 Deployment completed successfully!"
echo ""
echo "📱 Application URLs:"
echo "   Frontend: http://localhost:3000"
echo "   Backend API: http://localhost:5000/api"
echo "   API Health: http://localhost:5000/api/health"
echo ""
echo "👤 Default Admin Login:"
echo "   Username: itaymalka8"
echo "   Password: 1990"
echo ""
echo "📊 Useful Commands:"
echo "   View logs: docker-compose logs -f"
echo "   Stop services: docker-compose down"
echo "   Restart services: docker-compose restart"
echo "   View status: docker-compose ps"
echo ""
echo "🔧 Database Access:"
echo "   Host: localhost"
echo "   Port: 5432"
echo "   Database: shift_scheduler"
echo "   Username: postgres"
echo "   Password: password"
echo ""

