@echo off
REM Test Script for Windows
REM This script runs tests for both frontend and backend

echo 🧪 Running Shift Scheduler Tests...
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

REM Run frontend tests
echo 🧪 Running frontend tests...
if exist "package.json" (
    npm test 2>nul
    if %errorlevel% equ 0 (
        echo ✅ Frontend tests passed!
    ) else (
        echo ⚠️  Frontend tests failed or not configured
    )
) else (
    echo ⚠️  Frontend tests not found
)

echo.

REM Run backend tests
echo 🧪 Running backend tests...
if exist "backend\package.json" (
    cd backend
    npm test 2>nul
    if %errorlevel% equ 0 (
        echo ✅ Backend tests passed!
    ) else (
        echo ⚠️  Backend tests failed or not configured
    )
    cd ..
) else (
    echo ⚠️  Backend tests not found
)

echo.
echo 🎉 Test run completed!
echo.
echo 📊 Test Summary:
echo    Frontend: Check output above
echo    Backend: Check output above
echo.
echo 🔧 To run individual tests:
echo    Frontend: npm test
echo    Backend: cd backend && npm test
echo.
pause

