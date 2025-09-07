@echo off
REM Backend Quick Start Script for Windows
REM This script starts the backend server with database setup

echo 🔧 Starting Shift Scheduler Backend...
echo =====================================
echo.

REM Check if we're in the backend directory
if not exist "package.json" (
    echo ❌ Error: Please run this script from the backend directory
    echo    Current directory: %CD%
    echo    Expected: backend/
    pause
    exit /b 1
)

echo 📁 Current directory: %CD%
echo.

REM Check if dependencies are installed
if not exist "node_modules" (
    echo 📦 Installing dependencies...
    npm install
    echo ✅ Dependencies installed!
    echo.
)

REM Check if PostgreSQL is running
echo 🔍 Checking PostgreSQL connection...
psql --version >nul 2>&1
if %errorlevel% equ 0 (
    psql -h localhost -U postgres -d shift_scheduler -c "SELECT 1;" >nul 2>&1
    if %errorlevel% equ 0 (
        echo ✅ PostgreSQL connection successful!
    ) else (
        echo ⚠️  PostgreSQL connection failed. Please ensure:
        echo    - PostgreSQL is installed and running
        echo    - Database 'shift_scheduler' exists
        echo    - User 'postgres' has access
        echo.
        echo Creating database if it doesn't exist...
        createdb -h localhost -U postgres shift_scheduler 2>nul || echo Database might already exist
    )
) else (
    echo ⚠️  PostgreSQL client not found. Please install PostgreSQL
    echo    The server will start but database operations will fail
)

echo.
echo 🚀 Starting backend server...
echo    API URL: http://localhost:5000/api
echo    Health Check: http://localhost:5000/api/health
echo.

REM Start the server
npm run dev

