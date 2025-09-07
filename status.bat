@echo off
REM Status Script for Windows
REM This script checks the status of all services

echo 📊 Shift Scheduler Status Check...
echo ==================================
echo.

REM Check if we're in the right directory
if not exist "package.json" (
    echo ❌ Error: Please run this script from the shift-scheduler directory
    echo    Current directory: %CD%
    echo    Expected: shift-scheduler/
    pause
    exit /b 1
)

echo 📁 Current directory: %CD%
echo.

REM Check Node.js
echo 🔍 Checking Node.js...
node --version >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
    echo ✅ Node.js: %NODE_VERSION%
) else (
    echo ❌ Node.js not found
)

REM Check npm
echo 🔍 Checking npm...
npm --version >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=*" %%i in ('npm --version') do set NPM_VERSION=%%i
    echo ✅ npm: %NPM_VERSION%
) else (
    echo ❌ npm not found
)

REM Check PostgreSQL
echo 🔍 Checking PostgreSQL...
psql --version >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=3" %%i in ('psql --version') do set PSQL_VERSION=%%i
    echo ✅ PostgreSQL: %PSQL_VERSION%
    
    REM Check if PostgreSQL is running
    pg_isready -h localhost -p 5432 >nul 2>&1
    if %errorlevel% equ 0 (
        echo ✅ PostgreSQL service: Running
    ) else (
        echo ❌ PostgreSQL service: Not running
    )
) else (
    echo ❌ PostgreSQL not found
)

REM Check Docker
echo 🔍 Checking Docker...
docker --version >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=3" %%i in ('docker --version') do set DOCKER_VERSION=%%i
    echo ✅ Docker: %DOCKER_VERSION%
    
    REM Check if Docker is running
    docker info >nul 2>&1
    if %errorlevel% equ 0 (
        echo ✅ Docker service: Running
    ) else (
        echo ❌ Docker service: Not running
    )
) else (
    echo ❌ Docker not found
)

REM Check Docker Compose
echo 🔍 Checking Docker Compose...
docker-compose --version >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=3" %%i in ('docker-compose --version') do set COMPOSE_VERSION=%%i
    echo ✅ Docker Compose: %COMPOSE_VERSION%
) else (
    echo ❌ Docker Compose not found
)

echo.

REM Check Frontend
echo 🔍 Checking Frontend...
if exist "node_modules" (
    echo ✅ Frontend dependencies: Installed
) else (
    echo ❌ Frontend dependencies: Not installed
)

if exist ".next" (
    echo ✅ Frontend build: Built
) else (
    echo ❌ Frontend build: Not built
)

REM Check Backend
echo 🔍 Checking Backend...
if exist "backend\node_modules" (
    echo ✅ Backend dependencies: Installed
) else (
    echo ❌ Backend dependencies: Not installed
)

if exist "backend\server.js" (
    echo ✅ Backend server: Found
) else (
    echo ❌ Backend server: Not found
)

echo.

REM Check running services
echo 🔍 Checking running services...

REM Check Frontend (port 3000)
curl -f http://localhost:3000 >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Frontend: Running on http://localhost:3000
) else (
    echo ❌ Frontend: Not running
)

REM Check Backend (port 5000)
curl -f http://localhost:5000/api/health >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Backend: Running on http://localhost:5000/api
) else (
    echo ❌ Backend: Not running
)

REM Check Database (port 5432)
netstat -an | findstr :5432 >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Database: Running on localhost:5432
) else (
    echo ❌ Database: Not running
)

echo.
echo 📊 Status Summary:
echo    Node.js: Check above
echo    npm: Check above
echo    PostgreSQL: Check above
echo    Docker: Check above
echo    Frontend: Check above
echo    Backend: Check above
echo    Database: Check above
echo.
echo 🔧 Quick Commands:
echo    Start all: start-all.bat
echo    Start Docker: start-docker.bat
echo    Setup database: setup-database.bat
echo    Clean: clean.bat
echo.
pause

