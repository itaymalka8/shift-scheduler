#!/bin/bash

# Monitor Script
# This script monitors the application status

echo "📊 Shift Scheduler Monitor..."
echo "============================="
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

# Function to check service status
check_service() {
    local service_name="$1"
    local url="$2"
    local port="$3"
    
    if curl -f "$url" &> /dev/null; then
        echo "✅ $service_name: Running on $url"
        return 0
    else
        echo "❌ $service_name: Not running on $url"
        return 1
    fi
}

# Function to check port
check_port() {
    local port="$1"
    local service_name="$2"
    
    if nc -z localhost "$port" &> /dev/null; then
        echo "✅ $service_name: Port $port is open"
        return 0
    else
        echo "❌ $service_name: Port $port is closed"
        return 1
    fi
}

# Monitor loop
monitor_loop() {
    while true; do
        clear
        echo "📊 Shift Scheduler Monitor - $(date)"
        echo "====================================="
        echo ""
        
        # Check Frontend
        echo "🌐 Frontend Status:"
        check_service "Frontend" "http://localhost:3000" "3000"
        
        # Check Backend
        echo "🔧 Backend Status:"
        check_service "Backend API" "http://localhost:5000/api/health" "5000"
        
        # Check Database
        echo "🗄️  Database Status:"
        check_port "5432" "PostgreSQL"
        
        # Check Docker
        echo "🐳 Docker Status:"
        if command -v docker &> /dev/null && docker info &> /dev/null; then
            echo "✅ Docker: Running"
            if command -v docker-compose &> /dev/null; then
                echo "✅ Docker Compose: Available"
            else
                echo "❌ Docker Compose: Not available"
            fi
        else
            echo "❌ Docker: Not running"
        fi
        
        echo ""
        echo "📊 System Resources:"
        echo "==================="
        
        # CPU Usage
        if command -v top &> /dev/null; then
            CPU_USAGE=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1)
            echo "💻 CPU Usage: ${CPU_USAGE}%"
        fi
        
        # Memory Usage
        if command -v free &> /dev/null; then
            MEMORY_USAGE=$(free | grep Mem | awk '{printf "%.1f", $3/$2 * 100.0}')
            echo "🧠 Memory Usage: ${MEMORY_USAGE}%"
        fi
        
        # Disk Usage
        if command -v df &> /dev/null; then
            DISK_USAGE=$(df -h . | awk 'NR==2 {print $5}')
            echo "💾 Disk Usage: $DISK_USAGE"
        fi
        
        echo ""
        echo "🔄 Refreshing in 5 seconds... (Press Ctrl+C to exit)"
        sleep 5
    done
}

# Start monitoring
echo "🚀 Starting monitor..."
echo "Press Ctrl+C to exit"
echo ""

monitor_loop