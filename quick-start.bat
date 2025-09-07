@echo off
rem Quick Start Script for Windows
rem This script provides a quick way to start the Shift Scheduler application

echo 🚀 Quick Start - Shift Scheduler
echo =================================
echo.

rem Check if we're in the right directory
if not exist "package.json" (
    echo ❌ Error: Please run this script from the shift-scheduler directory
    echo    Current directory: %CD%
    echo    Expected: shift-scheduler\
    pause
    exit /b 1
)

echo 📁 Current directory: %CD%
echo.

rem Check if application is already installed
if not exist "node_modules" (
    echo 📦 Application not installed. Installing...
    call install.bat
    if %errorlevel% neq 0 (
        echo ❌ Installation failed
        pause
        exit /b 1
    )
    echo.
) else if not exist "backend\node_modules" (
    echo 📦 Backend not installed. Installing...
    call install.bat
    if %errorlevel% neq 0 (
        echo ❌ Installation failed
        pause
        exit /b 1
    )
    echo.
)

rem Check if database is set up
psql --version >nul 2>&1
if %errorlevel% equ 0 (
    psql -h localhost -U postgres -d shift_scheduler -c "SELECT 1;" >nul 2>&1
    if %errorlevel% neq 0 (
        echo 🗄️  Database not set up. Setting up...
        call setup-database.bat
        if %errorlevel% neq 0 (
            echo ❌ Database setup failed
            pause
            exit /b 1
        )
        echo.
    )
)

rem Start the application
echo 🚀 Starting Shift Scheduler...
echo.

rem Check if Docker is available
docker ps >nul 2>&1
if %errorlevel% equ 0 (
    echo 🐳 Starting with Docker...
    call start-docker.bat
) else (
    echo 📱 Starting with npm...
    call start-all.bat
)

echo.
echo 🎉 Shift Scheduler is starting!
echo.
echo 📱 Application URLs:
echo ===================
echo    Frontend: http://localhost:3000
echo    Backend API: http://localhost:5000/api
echo    Health Check: http://localhost:5000/api/health
echo.
echo 👤 Default Admin Login:
echo =====================
echo    Username: itaymalka8
echo    Password: 1990
echo.
echo 🔧 Management Commands:
echo ======================
echo    Check status: status.bat
echo    View logs: logs.bat
echo    Monitor: monitor.bat
echo    Stop: stop-all.bat
echo.
echo 🎉 Happy coding!
echo.
pause