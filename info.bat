@echo off
REM Info Script for Windows
REM This script shows detailed information about the application

echo ℹ️  Shift Scheduler - Application Information
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

REM Application Information
echo 📱 Application Information:
echo ===========================
echo    Name: Shift Scheduler
echo    Description: מערכת ניהול משמרות מודיעין בילוש שפט
for /f "tokens=4 delims=:," %%a in ('findstr "version" package.json') do (
    set VERSION=%%a
    set VERSION=!VERSION:"=!
    set VERSION=!VERSION: =!
)
echo    Version: %VERSION%
echo    Author: Itay Malka
echo    License: MIT
echo.

REM Technology Stack
echo 🔧 Technology Stack:
echo ====================
echo    Frontend: Next.js 15, TypeScript, Tailwind CSS
echo    Backend: Node.js, Express.js, PostgreSQL
echo    Database: PostgreSQL 15
echo    Authentication: JWT
echo    Security: Helmet, CORS, Rate Limiting
echo    Deployment: Docker, Docker Compose
echo.

REM System Requirements
echo 💻 System Requirements:
echo ======================
echo    Node.js: 18+
echo    npm: 8+
echo    PostgreSQL: 15+
echo    Docker: 20+ (optional)
echo    Docker Compose: 2+ (optional)
echo    Memory: 2GB+
echo    Storage: 1GB+
echo.

REM Ports
echo 🔌 Ports:
echo ========
echo    Frontend: 3000
echo    Backend: 5000
echo    Database: 5432
echo.

REM URLs
echo 🌐 URLs:
echo =======
echo    Frontend: http://localhost:3000
echo    Backend API: http://localhost:5000/api
echo    Health Check: http://localhost:5000/api/health
echo.

REM Default Users
echo 👤 Default Users:
echo =================
echo    Admin:
echo      Username: itaymalka8
echo      Password: 1990
echo      Permissions: All
echo.
echo    Admin:
echo      Username: admin
echo      Password: admin123
echo      Permissions: All
echo.

REM Database Information
echo 🗄️  Database Information:
echo ========================
echo    Host: localhost
echo    Port: 5432
echo    Database: shift_scheduler
echo    Username: postgres
echo    Password: (your PostgreSQL password)
echo.

REM Features
echo ✨ Features:
echo ============
echo    🔐 Authentication & Authorization
echo    👥 User Management
echo    👷 Employee Management
echo    🚗 Vehicle Management
echo    📅 Schedule Management
echo    📋 Work Planning
echo    📝 Request System
echo    📊 Reports & Summaries
echo    📱 Mobile Support
echo    🐳 Docker Support
echo.

REM API Endpoints
echo 🔗 API Endpoints:
echo =================
echo    Authentication:
echo      POST /api/auth/register
echo      POST /api/auth/login
echo      GET /api/auth/me
echo.
echo    Users:
echo      GET /api/users
echo      POST /api/users
echo      PUT /api/users/:id
echo      DELETE /api/users/:id
echo.
echo    Employees:
echo      GET /api/employees
echo      POST /api/employees
echo      PUT /api/employees/:id
echo      DELETE /api/employees/:id
echo.
echo    Vehicles:
echo      GET /api/vehicles
echo      POST /api/vehicles
echo      PUT /api/vehicles/:id
echo      DELETE /api/vehicles/:id
echo.
echo    Schedule:
echo      GET /api/schedule/week/:date
echo      POST /api/schedule/assign
echo      DELETE /api/schedule/unassign
echo.
echo    Work Plans:
echo      GET /api/workplan/:date
echo      POST /api/workplan
echo      PUT /api/workplan/shift-tasks
echo.
echo    Requests:
echo      GET /api/requests
echo      POST /api/requests
echo      PUT /api/requests/:id/approve
echo      PUT /api/requests/:id/reject
echo.

REM Scripts
echo 📜 Available Scripts:
echo ======================
echo    Quick Start:
echo      quick-start.bat
echo      start-all.bat
echo      start-docker.bat
echo.
echo    Individual Services:
echo      start-frontend.bat
echo      backend\start.bat
echo.
echo    Database:
echo      setup-database.bat
echo.
echo    Development:
echo      run-tests.bat
echo      build.bat
echo      clean.bat
echo.
echo    Monitoring:
echo      status.bat
echo      health.bat
echo      monitor.bat
echo      logs.bat
echo.
echo    Maintenance:
echo      update.bat
echo      reset.bat
echo      backup.bat
echo      restore.bat
echo.
echo    Help:
echo      help.bat
echo.

REM Support
echo 📞 Support:
echo ===========
echo    Email: itaymalka8@gmail.com
echo    GitHub: Create an issue
echo    Documentation: README.md
echo.

echo 🎉 Happy coding!
echo.
pause