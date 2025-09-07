@echo off
REM Monitor Script for Windows
REM This script monitors the application status

echo 📊 Shift Scheduler Monitor...
echo =============================
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

REM Monitor loop
:monitor_loop
cls
echo 📊 Shift Scheduler Monitor - %date% %time%
echo =====================================
echo.

REM Check Frontend
echo 🌐 Frontend Status:
curl -f http://localhost:3000 >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Frontend: Running on http://localhost:3000
) else (
    echo ❌ Frontend: Not running on http://localhost:3000
)

REM Check Backend
echo 🔧 Backend Status:
curl -f http://localhost:5000/api/health >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Backend API: Running on http://localhost:5000/api/health
) else (
    echo ❌ Backend API: Not running on http://localhost:5000/api/health
)

REM Check Database
echo 🗄️  Database Status:
netstat -an | findstr :5432 >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ PostgreSQL: Port 5432 is open
) else (
    echo ❌ PostgreSQL: Port 5432 is closed
)

REM Check Docker
echo 🐳 Docker Status:
docker --version >nul 2>&1
if %errorlevel% equ 0 (
    docker info >nul 2>&1
    if %errorlevel% equ 0 (
        echo ✅ Docker: Running
        docker-compose --version >nul 2>&1
        if %errorlevel% equ 0 (
            echo ✅ Docker Compose: Available
        ) else (
            echo ❌ Docker Compose: Not available
        )
    ) else (
        echo ❌ Docker: Not running
    )
) else (
    echo ❌ Docker: Not found
)

echo.
echo 📊 System Resources:
echo ===================

REM CPU Usage
for /f "tokens=2 delims=," %%a in ('wmic cpu get loadpercentage /value') do (
    if "%%a" neq "" (
        echo 💻 CPU Usage: %%a%%
    )
)

REM Memory Usage
for /f "tokens=2 delims=," %%a in ('wmic OS get TotalVisibleMemorySize /value') do (
    if "%%a" neq "" (
        set /a TOTAL_MEM=%%a
    )
)
for /f "tokens=2 delims=," %%a in ('wmic OS get FreePhysicalMemory /value') do (
    if "%%a" neq "" (
        set /a FREE_MEM=%%a
    )
)
if defined TOTAL_MEM if defined FREE_MEM (
    set /a USED_MEM=%TOTAL_MEM%-%FREE_MEM%
    set /a MEM_PERCENT=%USED_MEM%*100/%TOTAL_MEM%
    echo 🧠 Memory Usage: %MEM_PERCENT%%
)

REM Disk Usage
for /f "tokens=3" %%a in ('dir /-c %CD%') do (
    echo 💾 Disk Usage: %%a
)

echo.
echo 🔄 Refreshing in 5 seconds... (Press Ctrl+C to exit)
timeout /t 5 /nobreak >nul
goto :monitor_loop