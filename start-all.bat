@echo off
REM Full Stack Start Script for Windows
REM This script starts both frontend and backend

echo 🚀 Starting Shift Scheduler Full Stack...
echo =========================================
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

REM Install frontend dependencies
if not exist "node_modules" (
    echo 📦 Installing frontend dependencies...
    npm install
    echo ✅ Frontend dependencies installed!
    echo.
)

REM Install backend dependencies
if not exist "backend\node_modules" (
    echo 📦 Installing backend dependencies...
    cd backend
    npm install
    cd ..
    echo ✅ Backend dependencies installed!
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
)

echo.
echo 🚀 Starting services...
echo.

REM Start backend in background
echo 🔧 Starting backend server...
start "Backend Server" cmd /k "cd backend && npm run dev"

REM Wait a moment for backend to start
timeout /t 5 /nobreak >nul

REM Start frontend
echo 🌐 Starting frontend server...
echo.
echo 📱 Application URLs:
echo    Frontend: http://localhost:3000
echo    Backend API: http://localhost:5000/api
echo    Health Check: http://localhost:5000/api/health
echo.
echo 👤 Default Admin Login:
echo    Username: itaymalka8
echo    Password: 1990
echo.
echo Press any key to stop both services
echo.

REM Start frontend
npm run dev

echo.
echo 🛑 Stopping services...
echo ✅ Services stopped
pause

