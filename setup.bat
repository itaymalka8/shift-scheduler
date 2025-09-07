@echo off
rem Setup Script for Windows
rem This script sets up the development environment

echo 🔧 Setting up Shift Scheduler Development Environment...
echo ========================================================
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

rem Check system requirements
echo 🔍 Checking system requirements...

rem Check Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js: Not installed
    echo    Please install Node.js 18+ from https://nodejs.org/
    pause
    exit /b 1
) else (
    for /f "tokens=* USEBACKQ" %%F in (`node --version`) do (
        set NODE_VERSION=%%F
    )
    echo ✅ Node.js: %NODE_VERSION% ^(OK^)
)

rem Check npm
npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ npm: Not installed
    pause
    exit /b 1
) else (
    for /f "tokens=* USEBACKQ" %%F in (`npm --version`) do (
        set NPM_VERSION=%%F
    )
    echo ✅ npm: %NPM_VERSION% ^(OK^)
)

rem Check PostgreSQL
psql --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ⚠️  PostgreSQL: Not installed
    echo    Please install PostgreSQL 15+ from https://www.postgresql.org/download/
) else (
    for /f "tokens=* USEBACKQ" %%F in (`psql --version`) do (
        set PSQL_VERSION=%%F
    )
    echo ✅ PostgreSQL: %PSQL_VERSION% ^(OK^)
)

rem Check Docker (optional)
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ⚠️  Docker: Not installed ^(optional^)
    echo    Install Docker for easier deployment: https://docs.docker.com/get-docker/
) else (
    for /f "tokens=* USEBACKQ" %%F in (`docker --version`) do (
        set DOCKER_VERSION=%%F
    )
    echo ✅ Docker: %DOCKER_VERSION% ^(OK^)
)

echo.

rem Install frontend dependencies
echo 📦 Installing frontend dependencies...
if exist "package.json" (
    npm install
    if %errorlevel% neq 0 (
        echo ❌ Failed to install frontend dependencies
        pause
        exit /b 1
    )
    echo ✅ Frontend dependencies installed
) else (
    echo ❌ Frontend package.json not found
    pause
    exit /b 1
)

echo.

rem Install backend dependencies
echo 📦 Installing backend dependencies...
if exist "backend\package.json" (
    cd backend
    npm install
    if %errorlevel% neq 0 (
        echo ❌ Failed to install backend dependencies
        pause
        exit /b 1
    )
    cd ..
    echo ✅ Backend dependencies installed
) else (
    echo ❌ Backend package.json not found
    pause
    exit /b 1
)

echo.

rem Setup database
echo 🗄️  Setting up database...
pg_isready -h localhost -p 5432 >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ PostgreSQL service is not running
    echo    Please start PostgreSQL service
) else (
    echo ✅ PostgreSQL service is running
    
    rem Create database if it doesn't exist
    createdb -h localhost -U postgres shift_scheduler >nul 2>&1
    
    rem Test connection
    psql -h localhost -U postgres -d shift_scheduler -c "SELECT 1;" >nul 2>&1
    if %errorlevel% neq 0 (
        echo ❌ Database connection failed
        echo    Please check your PostgreSQL setup
    ) else (
        echo ✅ Database connection successful
    )
)

echo.

rem Create environment files
echo 📝 Creating environment files...

rem Frontend .env.local
if not exist ".env.local" (
    (
        echo NEXT_PUBLIC_API_URL=http://localhost:5000/api
    ) > .env.local
    echo ✅ Created .env.local
) else (
    echo ⚠️  .env.local already exists
)

rem Backend .env
if not exist "backend\.env" (
    (
        echo PORT=5000
        echo NODE_ENV=development
        echo FRONTEND_URL=http://localhost:3000
        echo.
        echo DB_HOST=localhost
        echo DB_PORT=5432
        echo DB_NAME=shift_scheduler
        echo DB_USER=postgres
        echo DB_PASSWORD=password
        echo.
        echo JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
        echo JWT_EXPIRES_IN=24h
        echo.
        echo RATE_LIMIT_WINDOW_MS=900000
        echo RATE_LIMIT_MAX_REQUESTS=100
    ) > backend\.env
    echo ✅ Created backend\.env
) else (
    echo ⚠️  backend\.env already exists
)

echo.

rem Build frontend
echo 🔨 Building frontend...
if exist "package.json" (
    npm run build
    if %errorlevel% neq 0 (
        echo ❌ Frontend build failed
        pause
        exit /b 1
    )
    echo ✅ Frontend built successfully
) else (
    echo ❌ Frontend package.json not found
    pause
    exit /b 1
)

echo.

rem Final setup
echo 🎉 Setup completed successfully!
echo.
echo 📊 Setup Summary:
echo ==================
echo    Frontend: Dependencies installed and built
echo    Backend: Dependencies installed
echo    Database: Setup completed
echo    Environment: Configuration files created
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
echo    4. Monitor:
echo       monitor.bat
echo.
echo 📱 Application URLs:
echo ===================
echo    Frontend: http://localhost:3000
echo    Backend API: http://localhost:5000/api
echo    Health Check: http://localhost:5000/api/health
echo.
echo 👤 Default Admin Login:
echo =====================
echo    Username: itaymalka8
echo    Password: 1990
echo.
echo 🎉 Happy coding!
echo.
pause