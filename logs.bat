@echo off
REM Logs Script for Windows
REM This script shows logs for all services

echo 📋 Shift Scheduler Logs...
echo ==========================
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

REM Check if Docker is running
docker --version >nul 2>&1
if %errorlevel% equ 0 (
    docker info >nul 2>&1
    if %errorlevel% equ 0 (
        echo 🐳 Docker services detected!
        echo.
        echo 📋 Docker service logs:
        echo ======================
        docker-compose logs --tail=50
        echo.
        echo 🔍 To follow logs in real-time:
        echo    docker-compose logs -f
        echo.
        echo 🔍 To view specific service logs:
        echo    docker-compose logs -f frontend
        echo    docker-compose logs -f backend
        echo    docker-compose logs -f postgres
        echo.
    ) else (
        goto :manual_services
    )
) else (
    goto :manual_services
)

goto :end

:manual_services
echo 🔧 Manual services detected!
echo.
echo 📋 Manual service logs:
echo ======================

REM Check if services are running
tasklist /fi "imagename eq node.exe" | findstr "node.exe" >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Node.js services are running
) else (
    echo ❌ Node.js services are not running
)

tasklist /fi "imagename eq postgres.exe" | findstr "postgres.exe" >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ PostgreSQL service is running
) else (
    echo ❌ PostgreSQL service is not running
)

echo.
echo 🔍 To view logs:
echo    Frontend: Check terminal where 'npm run dev' is running
echo    Backend: Check terminal where 'cd backend && npm run dev' is running
echo    PostgreSQL: Check system logs
echo.

:end
echo 📊 Log locations:
echo =================
echo    Frontend: Terminal output
echo    Backend: Terminal output
echo    Database: System logs
echo    Docker: docker-compose logs -f
echo.
echo 🔧 Useful log commands:
echo ========================
echo    docker-compose logs -f                    - Follow all logs
echo    docker-compose logs -f --tail=100         - Show last 100 lines
echo    docker-compose logs -f frontend           - Frontend logs only
echo    docker-compose logs -f backend            - Backend logs only
echo    docker-compose logs -f postgres           - Database logs only
echo.
pause