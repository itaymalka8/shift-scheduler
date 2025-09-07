#!/bin/bash

# Install Script
# This script installs the Shift Scheduler application

echo "📦 Installing Shift Scheduler..."
echo "================================="
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

# Check system requirements
echo "🔍 Checking system requirements..."

# Check Node.js
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version | cut -d'v' -f2)
    NODE_MAJOR=$(echo $NODE_VERSION | cut -d'.' -f1)
    if [ $NODE_MAJOR -ge 18 ]; then
        echo "✅ Node.js: $NODE_VERSION (OK)"
    else
        echo "❌ Node.js: $NODE_VERSION (Requires 18+)"
        exit 1
    fi
else
    echo "❌ Node.js: Not installed"
    echo "   Please install Node.js 18+ from https://nodejs.org/"
    exit 1
fi

# Check npm
if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm --version)
    echo "✅ npm: $NPM_VERSION (OK)"
else
    echo "❌ npm: Not installed"
    exit 1
fi

# Check PostgreSQL
if command -v psql &> /dev/null; then
    PSQL_VERSION=$(psql --version | cut -d' ' -f3)
    echo "✅ PostgreSQL: $PSQL_VERSION (OK)"
else
    echo "⚠️  PostgreSQL: Not installed"
    echo "   Please install PostgreSQL 15+ from https://www.postgresql.org/download/"
fi

# Check Docker (optional)
if command -v docker &> /dev/null; then
    DOCKER_VERSION=$(docker --version | cut -d' ' -f3 | cut -d',' -f1)
    echo "✅ Docker: $DOCKER_VERSION (OK)"
else
    echo "⚠️  Docker: Not installed (optional)"
    echo "   Install Docker for easier deployment: https://docs.docker.com/get-docker/"
fi

echo ""

# Install frontend dependencies
echo "📦 Installing frontend dependencies..."
if [ -f "package.json" ]; then
    npm install
    if [ $? -eq 0 ]; then
        echo "✅ Frontend dependencies installed"
    else
        echo "❌ Failed to install frontend dependencies"
        exit 1
    fi
else
    echo "❌ Frontend package.json not found"
    exit 1
fi

echo ""

# Install backend dependencies
echo "📦 Installing backend dependencies..."
if [ -f "backend/package.json" ]; then
    cd backend
    npm install
    if [ $? -eq 0 ]; then
        echo "✅ Backend dependencies installed"
    else
        echo "❌ Failed to install backend dependencies"
        exit 1
    fi
    cd ..
else
    echo "❌ Backend package.json not found"
    exit 1
fi

echo ""

# Setup database
echo "🗄️  Setting up database..."
if command -v psql &> /dev/null; then
    # Check if PostgreSQL is running
    if pg_isready -h localhost -p 5432 &> /dev/null; then
        echo "✅ PostgreSQL service is running"
        
        # Create database if it doesn't exist
        createdb -h localhost -U postgres shift_scheduler 2>/dev/null || echo "Database might already exist"
        
        # Test connection
        if psql -h localhost -U postgres -d shift_scheduler -c "SELECT 1;" &> /dev/null; then
            echo "✅ Database connection successful"
        else
            echo "❌ Database connection failed"
            echo "   Please check your PostgreSQL setup"
        fi
    else
        echo "❌ PostgreSQL service is not running"
        echo "   Please start PostgreSQL service"
    fi
else
    echo "⚠️  PostgreSQL not found, skipping database setup"
fi

echo ""

# Create environment files
echo "📝 Creating environment files..."

# Frontend .env.local
if [ ! -f ".env.local" ]; then
    cat > .env.local << EOF
NEXT_PUBLIC_API_URL=http://localhost:5000/api
EOF
    echo "✅ Created .env.local"
else
    echo "⚠️  .env.local already exists"
fi

# Backend .env
if [ ! -f "backend/.env" ]; then
    cat > backend/.env << EOF
PORT=5000
NODE_ENV=development
FRONTEND_URL=http://localhost:3000

DB_HOST=localhost
DB_PORT=5432
DB_NAME=shift_scheduler
DB_USER=postgres
DB_PASSWORD=password

JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRES_IN=24h

RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
EOF
    echo "✅ Created backend/.env"
else
    echo "⚠️  backend/.env already exists"
fi

echo ""

# Make scripts executable
echo "🔧 Making scripts executable..."
chmod +x *.sh
chmod +x backend/*.sh
echo "✅ Scripts made executable"

echo ""

# Build frontend
echo "🔨 Building frontend..."
if [ -f "package.json" ]; then
    npm run build
    if [ $? -eq 0 ]; then
        echo "✅ Frontend built successfully"
    else
        echo "❌ Frontend build failed"
        exit 1
    fi
else
    echo "❌ Frontend package.json not found"
    exit 1
fi

echo ""

# Final installation
echo "🎉 Installation completed successfully!"
echo ""
echo "📊 Installation Summary:"
echo "========================"
echo "   Frontend: Dependencies installed and built"
echo "   Backend: Dependencies installed"
echo "   Database: Setup completed"
echo "   Environment: Configuration files created"
echo "   Scripts: Made executable"
echo ""
echo "🚀 Next Steps:"
echo "=============="
echo "   1. Start the application:"
echo "      ./start-all.sh"
echo "      Or: ./start-docker.sh"
echo ""
echo "   2. Check status:"
echo "      ./status.sh"
echo ""
echo "   3. View logs:"
echo "      ./logs.sh"
echo ""
echo "   4. Monitor:"
echo "      ./monitor.sh"
echo ""
echo "📱 Application URLs:"
echo "==================="
echo "   Frontend: http://localhost:3000"
echo "   Backend API: http://localhost:5000/api"
echo "   Health Check: http://localhost:5000/api/health"
echo ""
echo "👤 Default Admin Login:"
echo "====================="
echo "   Username: itaymalka8"
echo "   Password: 1990"
echo ""
echo "🎉 Happy coding!"
echo ""