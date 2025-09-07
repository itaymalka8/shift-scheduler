@echo off
REM Health Check Script for Windows
REM This script performs a comprehensive health check

echo 🏥 Shift Scheduler Health Check...
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

REM Health check results
set FRONTEND_HEALTH=0
set BACKEND_HEALTH=0
set DATABASE_HEALTH=0
set DOCKER_HEALTH=0
set OVERALL_HEALTH=0

REM Check Frontend
echo 🌐 Checking Frontend...
curl -f http://localhost:3000 >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Frontend: Healthy
    set FRONTEND_HEALTH=1
) else (
    echo ❌ Frontend: Unhealthy
)

REM Check Backend
echo 🔧 Checking Backend...
curl -f http://localhost:5000/api/health >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Backend: Healthy
    set BACKEND_HEALTH=1
) else (
    echo ❌ Backend: Unhealthy
)

REM Check Database
echo 🗄️  Checking Database...
netstat -an | findstr :5432 >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Database: Healthy
    set DATABASE_HEALTH=1
) else (
    echo ❌ Database: Unhealthy
)

REM Check Docker
echo 🐳 Checking Docker...
docker --version >nul 2>&1
if %errorlevel% equ 0 (
    docker info >nul 2>&1
    if %errorlevel% equ 0 (
        echo ✅ Docker: Healthy
        set DOCKER_HEALTH=1
    ) else (
        echo ❌ Docker: Unhealthy
    )
) else (
    echo ❌ Docker: Unhealthy
)

echo.

REM Calculate overall health
set /a TOTAL_CHECKS=4
set /a HEALTHY_CHECKS=%FRONTEND_HEALTH%+%BACKEND_HEALTH%+%DATABASE_HEALTH%+%DOCKER_HEALTH%
set /a HEALTH_PERCENTAGE=%HEALTHY_CHECKS%*100/%TOTAL_CHECKS%

echo 📊 Health Summary:
echo ==================
if %FRONTEND_HEALTH% equ 1 (
    echo    Frontend: ✅ Healthy
) else (
    echo    Frontend: ❌ Unhealthy
)

if %BACKEND_HEALTH% equ 1 (
    echo    Backend: ✅ Healthy
) else (
    echo    Backend: ❌ Unhealthy
)

if %DATABASE_HEALTH% equ 1 (
    echo    Database: ✅ Healthy
) else (
    echo    Database: ❌ Unhealthy
)

if %DOCKER_HEALTH% equ 1 (
    echo    Docker: ✅ Healthy
) else (
    echo    Docker: ❌ Unhealthy
)

echo.
echo 🏥 Overall Health: %HEALTH_PERCENTAGE%% (%HEALTHY_CHECKS%/%TOTAL_CHECKS% services healthy)

REM Determine health status
if %HEALTH_PERCENTAGE% equ 100 (
    echo 🎉 All services are healthy!
    set OVERALL_HEALTH=1
) else if %HEALTH_PERCENTAGE% geq 75 (
    echo ⚠️  Most services are healthy, but some issues detected
) else if %HEALTH_PERCENTAGE% geq 50 (
    echo ⚠️  Some services are healthy, but significant issues detected
) else (
    echo ❌ Critical issues detected, immediate attention required
)

echo.

REM Recommendations
echo 🔧 Recommendations:
echo ===================

if %FRONTEND_HEALTH% equ 0 (
    echo    • Start frontend: npm run dev
)

if %BACKEND_HEALTH% equ 0 (
    echo    • Start backend: cd backend && npm run dev
)

if %DATABASE_HEALTH% equ 0 (
    echo    • Start PostgreSQL service
    echo    • Check database connection settings
)

if %DOCKER_HEALTH% equ 0 (
    echo    • Start Docker service
    echo    • Check Docker installation
)

if %OVERALL_HEALTH% equ 1 (
    echo    • All services are running properly
    echo    • No immediate action required
)

echo.

REM Quick fixes
echo 🚀 Quick Fixes:
echo ===============
echo    • Start all services: start-all.bat
echo    • Start with Docker: start-docker.bat
echo    • Check status: status.bat
echo    • View logs: logs.bat
echo    • Monitor: monitor.bat
echo.

REM Exit with appropriate code
if %OVERALL_HEALTH% equ 1 (
    exit /b 0
) else (
    exit /b 1
)