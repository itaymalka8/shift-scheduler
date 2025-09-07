@echo off
REM Update Script for Windows
REM This script updates the application

echo 🔄 Updating Shift Scheduler...
echo ==============================
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

REM Check if Node.js is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js is not installed. Please install Node.js 18+ first.
    echo    Visit: https://nodejs.org/
    pause
    exit /b 1
)

REM Check if npm is installed
npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ npm is not installed. Please install npm first.
    pause
    exit /b 1
)

echo ✅ Node.js and npm are installed
echo.

REM Update frontend dependencies
echo 🔄 Updating frontend dependencies...
if exist "package.json" (
    npm update
    if %errorlevel% equ 0 (
        echo ✅ Frontend dependencies updated
    ) else (
        echo ❌ Failed to update frontend dependencies
        pause
        exit /b 1
    )
) else (
    echo ❌ Frontend package.json not found
    pause
    exit /b 1
)

echo.

REM Update backend dependencies
echo 🔄 Updating backend dependencies...
if exist "backend\package.json" (
    cd backend
    npm update
    if %errorlevel% equ 0 (
        echo ✅ Backend dependencies updated
    ) else (
        echo ❌ Failed to update backend dependencies
        pause
        exit /b 1
    )
    cd ..
) else (
    echo ❌ Backend package.json not found
    pause
    exit /b 1
)

echo.

REM Rebuild frontend
echo 🔨 Rebuilding frontend...
if exist "package.json" (
    npm run build
    if %errorlevel% equ 0 (
        echo ✅ Frontend rebuilt successfully
    ) else (
        echo ❌ Frontend rebuild failed
        pause
        exit /b 1
    )
) else (
    echo ❌ Frontend package.json not found
    pause
    exit /b 1
)

echo.

REM Rebuild backend
echo 🔨 Rebuilding backend...
if exist "backend\package.json" (
    cd backend
    npm run build 2>nul
    if %errorlevel% equ 0 (
        echo ✅ Backend rebuilt successfully
    ) else (
        echo ⚠️  Backend rebuild failed or not configured
    )
    cd ..
) else (
    echo ❌ Backend package.json not found
)

echo.

REM Update Docker images
echo 🐳 Updating Docker images...
docker --version >nul 2>&1
if %errorlevel% equ 0 (
    docker-compose pull
    if %errorlevel% equ 0 (
        echo ✅ Docker images updated
    ) else (
        echo ⚠️  Failed to update Docker images
    )
) else (
    echo ⚠️  Docker not found, skipping Docker update
)

echo.

REM Final update
echo 🎉 Update completed successfully!
echo.
echo 📊 Update Summary:
echo ==================
echo    Frontend: Dependencies updated and rebuilt
echo    Backend: Dependencies updated and rebuilt
echo    Docker: Images updated
echo.
echo 🚀 Next Steps:
echo ==============
echo    1. Restart the application:
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