@echo off
REM Database Setup Script for Windows
REM This script sets up the PostgreSQL database

echo 🗄️  Setting up Shift Scheduler Database...
echo ==========================================
echo.

REM Check if PostgreSQL is installed
psql --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ PostgreSQL is not installed. Please install PostgreSQL first.
    echo    Visit: https://www.postgresql.org/download/
    pause
    exit /b 1
)

echo ✅ PostgreSQL is installed
echo.

REM Check if PostgreSQL service is running
pg_isready -h localhost -p 5432 >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ PostgreSQL service is not running. Please start PostgreSQL first.
    echo    On Windows: Start PostgreSQL service from Services
    pause
    exit /b 1
)

echo ✅ PostgreSQL service is running
echo.

REM Create database if it doesn't exist
echo 🔨 Creating database 'shift_scheduler'...
createdb -h localhost -U postgres shift_scheduler 2>nul || echo Database might already exist

REM Test connection
echo 🔍 Testing database connection...
psql -h localhost -U postgres -d shift_scheduler -c "SELECT 1;" >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Database connection successful!
) else (
    echo ❌ Database connection failed. Please check your PostgreSQL setup.
    pause
    exit /b 1
)

echo.
echo 🎉 Database setup completed successfully!
echo.
echo 📊 Database Information:
echo    Host: localhost
echo    Port: 5432
echo    Database: shift_scheduler
echo    Username: postgres
echo    Password: (your PostgreSQL password)
echo.
echo 🔧 Next Steps:
echo    1. Run the backend: cd backend && npm run dev
echo    2. The database will be initialized automatically
echo    3. Or run manually: node backend/database/init.js
echo.
pause

