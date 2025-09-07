@echo off
rem Uninstall Script for Windows
rem This script removes the Shift Scheduler application

echo 🗑️  Uninstalling Shift Scheduler...
echo ====================================
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

rem Confirm uninstall
echo ⚠️  This will remove the Shift Scheduler application and all its data.
echo    This action cannot be undone!
echo.
set /p REPLY=Are you sure you want to continue? (y/N): 
if /i not "%REPLY%"=="y" (
    echo ❌ Uninstall cancelled
    pause
    exit /b 0
)

echo.

rem Stop all services
echo 🛑 Stopping all services...
if exist "stop-all.bat" (
    call stop-all.bat
    echo ✅ All services stopped
) else (
    echo ⚠️  stop-all.bat not found, skipping service stop
)

echo.

rem Remove frontend dependencies
echo 🗑️  Removing frontend dependencies...
if exist "node_modules" (
    rmdir /s /q node_modules
    echo ✅ Frontend node_modules removed
) else (
    echo ⚠️  Frontend node_modules not found
)

if exist ".next" (
    rmdir /s /q .next
    echo ✅ Frontend build files removed
) else (
    echo ⚠️  Frontend build files not found
)

echo.

rem Remove backend dependencies
echo 🗑️  Removing backend dependencies...
if exist "backend\node_modules" (
    rmdir /s /q backend\node_modules
    echo ✅ Backend node_modules removed
) else (
    echo ⚠️  Backend node_modules not found
)

echo.

rem Remove environment files
echo 🗑️  Removing environment files...
if exist ".env.local" (
    del /f /q .env.local
    echo ✅ Frontend .env.local removed
) else (
    echo ⚠️  Frontend .env.local not found
)

if exist "backend\.env" (
    del /f /q backend\.env
    echo ✅ Backend .env removed
) else (
    echo ⚠️  Backend .env not found
)

echo.

rem Remove Docker containers and images
echo 🗑️  Removing Docker containers and images...
docker --version >nul 2>&1
if %errorlevel% equ 0 (
    rem Stop and remove containers
    docker-compose down --volumes --remove-orphans >nul 2>&1
    
    rem Remove images
    docker rmi shift-scheduler-frontend >nul 2>&1
    docker rmi shift-scheduler-backend >nul 2>&1
    docker rmi postgres:15 >nul 2>&1
    
    echo ✅ Docker containers and images removed
) else (
    echo ⚠️  Docker not found, skipping Docker cleanup
)

echo.

rem Remove database (optional)
echo 🗑️  Removing database...
psql --version >nul 2>&1
if %errorlevel% equ 0 (
    set /p DB_REPLY=Do you want to remove the database? (y/N): 
    if /i "%DB_REPLY%"=="y" (
        dropdb -h localhost -U postgres shift_scheduler >nul 2>&1
        echo ✅ Database removed
    ) else (
        echo ⚠️  Database kept
    )
) else (
    echo ⚠️  PostgreSQL not found, skipping database removal
)

echo.

rem Remove logs
echo 🗑️  Removing logs...
if exist "logs" (
    rmdir /s /q logs
    echo ✅ Logs removed
) else (
    echo ⚠️  Logs directory not found
)

echo.

rem Remove backups
echo 🗑️  Removing backups...
if exist "backups" (
    rmdir /s /q backups
    echo ✅ Backups removed
) else (
    echo ⚠️  Backups directory not found
)

echo.

rem Remove temporary files
echo 🗑️  Removing temporary files...
if exist "tmp" (
    rmdir /s /q tmp
    echo ✅ Temporary files removed
) else (
    echo ⚠️  Temporary files not found
)

echo.

rem Final cleanup
echo 🎉 Uninstall completed successfully!
echo.
echo 📊 Uninstall Summary:
echo =====================
echo    Frontend: Dependencies and build files removed
echo    Backend: Dependencies removed
echo    Docker: Containers and images removed
echo    Database: Removed ^(if confirmed^)
echo    Environment: Configuration files removed
echo    Logs: Removed
echo    Backups: Removed
echo    Temporary: Files removed
echo.
echo 📁 Remaining files:
echo ===================
echo    Source code: Kept
echo    Scripts: Kept
echo    Documentation: Kept
echo.
echo 🔄 To reinstall:
echo ===============
echo    install.bat
echo.
echo 🎉 Thank you for using Shift Scheduler!
echo.
pause