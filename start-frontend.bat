@echo off
REM Frontend Quick Start Script for Windows
REM This script starts the frontend development server

echo 🌐 Starting Shift Scheduler Frontend...
echo =======================================
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

REM Check if dependencies are installed
if not exist "node_modules" (
    echo 📦 Installing dependencies...
    npm install
    echo ✅ Dependencies installed!
    echo.
)

REM Check if backend is running
echo 🔍 Checking backend connection...
curl -f http://localhost:5000/api/health >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Backend is running!
) else (
    echo ⚠️  Backend is not running. Please start the backend first:
    echo    cd backend && npm run dev
    echo.
    echo    Or run: backend\start.bat
    echo.
)

echo 🚀 Starting frontend server...
echo    Frontend URL: http://localhost:3000
echo    Backend API: http://localhost:5000/api
echo.

REM Start the server
npm run dev

