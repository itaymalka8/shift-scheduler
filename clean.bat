@echo off
REM Clean Script for Windows
REM This script cleans build artifacts and dependencies

echo 🧹 Cleaning Shift Scheduler...
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

REM Clean frontend
echo 🧹 Cleaning frontend...
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

echo.

REM Clean backend
echo 🧹 Cleaning backend...
if exist "backend\node_modules" (
    rmdir /s /q backend\node_modules
    echo ✅ Backend node_modules removed
)

if exist "backend\dist" (
    rmdir /s /q backend\dist
    echo ✅ Backend dist directory removed
)

echo.

REM Clean Docker
echo 🧹 Cleaning Docker...
docker --version >nul 2>&1
if %errorlevel% equ 0 (
    docker system prune -f
    echo ✅ Docker cleanup completed
) else (
    echo ⚠️  Docker not found, skipping Docker cleanup
)

echo.
echo 🎉 Clean completed successfully!
echo.
echo 📊 Clean Summary:
echo    Frontend: node_modules, .next, out removed
echo    Backend: node_modules, dist removed
echo    Docker: system cleanup completed
echo.
echo 🔧 To reinstall dependencies:
echo    Frontend: npm install
echo    Backend: cd backend && npm install
echo.
pause

