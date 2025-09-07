@echo off
REM Reset Script for Windows
REM This script resets the application to a clean state

echo 🔄 Resetting Shift Scheduler...
echo ===============================
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

REM Confirm reset
echo ⚠️  This will reset the application to a clean state.
echo    This will remove all dependencies and build artifacts.
echo    The source code will remain intact.
echo.
set /p confirm="Are you sure you want to continue? (y/N): "

if /i not "%confirm%"=="y" (
    echo ❌ Reset cancelled
    pause
    exit /b 0
)

echo.
echo 🔄 Starting reset...

REM Stop any running services
echo 🛑 Stopping running services...
taskkill /f /im node.exe 2>nul || echo No Node.js processes found

REM Remove frontend dependencies
echo 🧹 Removing frontend dependencies...
if exist "node_modules" (
    rmdir /s /q node_modules
    echo ✅ Frontend node_modules removed
)

if exist ".next" (
    rmdir /s /q .next
    echo ✅ Frontend .next directory removed
)

if exist "out" (
    rmdir /s /q out
    echo ✅ Frontend out directory removed
)

REM Remove backend dependencies
echo 🧹 Removing backend dependencies...
if exist "backend\node_modules" (
    rmdir /s /q backend\node_modules
    echo ✅ Backend node_modules removed
)

if exist "backend\dist" (
    rmdir /s /q backend\dist
    echo ✅ Backend dist directory removed
)

REM Remove environment files
echo 🧹 Removing environment files...
if exist ".env.local" (
    del .env.local
    echo ✅ Frontend .env.local removed
)

if exist "backend\.env" (
    del backend\.env
    echo ✅ Backend .env removed
)

REM Remove Docker containers and images
echo 🧹 Removing Docker containers and images...
docker --version >nul 2>&1
if %errorlevel% equ 0 (
    docker-compose down 2>nul || echo No Docker services running
    docker system prune -f
    echo ✅ Docker cleanup completed
) else (
    echo ⚠️  Docker not found, skipping Docker cleanup
)

REM Remove backup files
echo 🧹 Removing backup files...
if exist "backup-*.tar.gz" (
    del backup-*.tar.gz
    echo ✅ Backup files removed
)

if exist "backup-*.zip" (
    del backup-*.zip
    echo ✅ Backup files removed
)

echo.

REM Reinstall dependencies
echo 📦 Reinstalling dependencies...

REM Frontend
echo 📦 Installing frontend dependencies...
npm install
if %errorlevel% equ 0 (
    echo ✅ Frontend dependencies installed
) else (
    echo ❌ Failed to install frontend dependencies
    pause
    exit /b 1
)

REM Backend
echo 📦 Installing backend dependencies...
cd backend
npm install
if %errorlevel% equ 0 (
    echo ✅ Backend dependencies installed
) else (
    echo ❌ Failed to install backend dependencies
    pause
    exit /b 1
)
cd ..

echo.

REM Rebuild frontend
echo 🔨 Rebuilding frontend...
npm run build
if %errorlevel% equ 0 (
    echo ✅ Frontend rebuilt successfully
) else (
    echo ❌ Frontend rebuild failed
    pause
    exit /b 1
)

echo.

REM Final reset
echo 🎉 Reset completed successfully!
echo.
echo 📊 Reset Summary:
echo =================
echo    Frontend: Dependencies removed and reinstalled
echo    Backend: Dependencies removed and reinstalled
echo    Environment: Configuration files removed
echo    Docker: Containers and images removed
echo    Backups: Backup files removed
echo.
echo 🚀 Next Steps:
echo ==============
echo    1. Start the application:
echo       start-all.bat
echo       Or: start-docker.bat
echo.
echo    2. Check status:
echo       status.bat
echo.
echo    3. View logs:
echo       logs.bat
echo.
echo 📱 Application URLs:
echo ===================
echo    Frontend: http://localhost:3000
echo    Backend API: http://localhost:5000/api
echo    Health Check: http://localhost:5000/api/health
echo.
echo 👤 Default Admin Login:
echo ======================
echo    Username: itaymalka8
echo    Password: 1990
echo.
echo 🎉 Happy coding!
echo.
pause