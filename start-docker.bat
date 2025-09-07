@echo off
REM Docker Quick Start Script for Windows
REM This script starts the application using Docker

echo 🐳 Starting Shift Scheduler with Docker...
echo ==========================================
echo.

REM Check if we're in the right directory
if not exist "docker-compose.yml" (
    echo ❌ Error: Please run this script from the shift-scheduler directory
    echo    Current directory: %CD%
    echo    Expected: shift-scheduler/
    pause
    exit /b 1
)

echo 📁 Current directory: %CD%
echo.

REM Check if Docker is installed
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Docker is not installed. Please install Docker Desktop first.
    echo    Visit: https://docs.docker.com/get-docker/
    pause
    exit /b 1
)

REM Check if Docker Compose is installed
docker-compose --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Docker Compose is not installed. Please install Docker Compose first.
    echo    Visit: https://docs.docker.com/compose/install/
    pause
    exit /b 1
)

echo ✅ Docker and Docker Compose are installed
echo.

REM Stop existing containers
echo 🛑 Stopping existing containers...
docker-compose down

REM Remove old images (optional)
echo 🧹 Cleaning up old images...
docker system prune -f

REM Build and start services
echo 🔨 Building and starting services...
docker-compose up --build -d

REM Wait for services to be ready
echo ⏳ Waiting for services to be ready...
timeout /t 30 /nobreak >nul

REM Check if services are running
echo 🔍 Checking service status...
docker-compose ps

REM Test API health
echo 🏥 Testing API health...
curl -f http://localhost:5000/api/health >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Backend API is healthy
) else (
    echo ❌ Backend API is not responding
    echo    Check logs: docker-compose logs backend
    pause
    exit /b 1
)

REM Test Frontend
echo 🌐 Testing Frontend...
curl -f http://localhost:3000 >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Frontend is healthy
) else (
    echo ❌ Frontend is not responding
    echo    Check logs: docker-compose logs frontend
    pause
    exit /b 1
)

echo.
echo 🎉 Deployment completed successfully!
echo.
echo 📱 Application URLs:
echo    Frontend: http://localhost:3000
echo    Backend API: http://localhost:5000/api
echo    API Health: http://localhost:5000/api/health
echo.
echo 👤 Default Admin Login:
echo    Username: itaymalka8
echo    Password: 1990
echo.
echo 📊 Useful Commands:
echo    View logs: docker-compose logs -f
echo    Stop services: docker-compose down
echo    Restart services: docker-compose restart
echo    View status: docker-compose ps
echo.
echo 🔧 Database Access:
echo    Host: localhost
echo    Port: 5432
echo    Database: shift_scheduler
echo    Username: postgres
echo    Password: password
echo.
pause

