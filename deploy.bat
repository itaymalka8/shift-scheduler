@echo off
REM Shift Scheduler Deployment Script for Windows
REM This script deploys the Shift Scheduler application using Docker

echo 🚀 Starting Shift Scheduler Deployment...

REM Check if Docker is installed
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Docker is not installed. Please install Docker Desktop first.
    pause
    exit /b 1
)

REM Check if Docker Compose is installed
docker-compose --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Docker Compose is not installed. Please install Docker Compose first.
    pause
    exit /b 1
)

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
    pause
    exit /b 1
)

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
echo 📊 To view logs: docker-compose logs -f
echo 🛑 To stop: docker-compose down
echo.
pause

