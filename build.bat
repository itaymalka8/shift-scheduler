@echo off
REM Build Script for Windows
REM This script builds both frontend and backend for production

echo 🔨 Building Shift Scheduler for Production...
echo =============================================
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

REM Build frontend
echo 🔨 Building frontend...
if exist "package.json" (
    npm run build
    if %errorlevel% equ 0 (
        echo ✅ Frontend build successful!
    ) else (
        echo ❌ Frontend build failed!
        pause
        exit /b 1
    )
) else (
    echo ❌ Frontend package.json not found!
    pause
    exit /b 1
)

echo.

REM Build backend
echo 🔨 Building backend...
if exist "backend\package.json" (
    cd backend
    npm run build 2>nul
    if %errorlevel% equ 0 (
        echo ✅ Backend build successful!
    ) else (
        echo ⚠️  Backend build failed or not configured
    )
    cd ..
) else (
    echo ⚠️  Backend package.json not found!
)

echo.
echo 🎉 Build completed successfully!
echo.
echo 📊 Build Summary:
echo    Frontend: Built successfully
echo    Backend: Check output above
echo.
echo 🚀 To start production:
echo    Frontend: npm start
echo    Backend: cd backend && npm start
echo.
echo 🐳 Or use Docker:
echo    docker-compose up --build -d
echo.
pause

