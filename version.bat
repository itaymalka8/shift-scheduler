@echo off
REM Version Script for Windows
REM This script shows version information

echo 📋 Shift Scheduler - Version Information
echo ========================================
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

REM Frontend Version
echo 🌐 Frontend Version:
echo ===================
if exist "package.json" (
    for /f "tokens=4 delims=:," %%a in ('findstr "version" package.json') do (
        set VERSION=%%a
        set VERSION=!VERSION:"=!
        set VERSION=!VERSION: =!
    )
    echo    Version: %VERSION%
    
    REM Check if node_modules exists
    if exist "node_modules" (
        echo    Dependencies: Installed
    ) else (
        echo    Dependencies: Not installed
    )
    
    REM Check if .next exists
    if exist ".next" (
        echo    Build: Built
    ) else (
        echo    Build: Not built
    )
) else (
    echo    ❌ package.json not found
)

echo.

REM Backend Version
echo 🔧 Backend Version:
echo ==================
if exist "backend\package.json" (
    for /f "tokens=4 delims=:," %%a in ('findstr "version" backend\package.json') do (
        set BACKEND_VERSION=%%a
        set BACKEND_VERSION=!BACKEND_VERSION:"=!
        set BACKEND_VERSION=!BACKEND_VERSION: =!
    )
    echo    Version: %BACKEND_VERSION%
    
    REM Check if node_modules exists
    if exist "backend\node_modules" (
        echo    Dependencies: Installed
    ) else (
        echo    Dependencies: Not installed
    )
    
    REM Check if server.js exists
    if exist "backend\server.js" (
        echo    Server: Available
    ) else (
        echo    Server: Not available
    )
) else (
    echo    ❌ backend\package.json not found
)

echo.

REM System Versions
echo 💻 System Versions:
echo ==================

REM Node.js
node --version >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
    echo    Node.js: %NODE_VERSION%
) else (
    echo    Node.js: Not installed
)

REM npm
npm --version >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=*" %%i in ('npm --version') do set NPM_VERSION=%%i
    echo    npm: %NPM_VERSION%
) else (
    echo    npm: Not installed
)

REM PostgreSQL
psql --version >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=3" %%i in ('psql --version') do set PSQL_VERSION=%%i
    echo    PostgreSQL: %PSQL_VERSION%
) else (
    echo    PostgreSQL: Not installed
)

REM Docker
docker --version >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=3" %%i in ('docker --version') do set DOCKER_VERSION=%%i
    echo    Docker: %DOCKER_VERSION%
) else (
    echo    Docker: Not installed
)

REM Docker Compose
docker-compose --version >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=3" %%i in ('docker-compose --version') do set COMPOSE_VERSION=%%i
    echo    Docker Compose: %COMPOSE_VERSION%
) else (
    echo    Docker Compose: Not installed
)

echo.

REM Git Information
echo 📝 Git Information:
echo ==================
git --version >nul 2>&1
if %errorlevel% equ 0 (
    if exist ".git" (
        for /f "tokens=*" %%i in ('git branch --show-current 2^>nul') do set GIT_BRANCH=%%i
        for /f "tokens=*" %%i in ('git rev-parse HEAD 2^>nul') do set GIT_COMMIT=%%i
        for /f "tokens=*" %%i in ('git describe --tags 2^>nul') do set GIT_TAG=%%i
        
        echo    Branch: %GIT_BRANCH%
        echo    Commit: %GIT_COMMIT:~0,8%
        echo    Tag: %GIT_TAG%
    ) else (
        echo    Git: Not a git repository
    )
) else (
    echo    Git: Not available
)

echo.

REM Build Information
echo 🔨 Build Information:
echo ===================
if exist ".next" (
    echo    Frontend: Built
    if exist ".next\BUILD_ID" (
        for /f "tokens=*" %%i in ('type .next\BUILD_ID') do set BUILD_ID=%%i
        echo    Build ID: %BUILD_ID%
    )
) else (
    echo    Frontend: Not built
)

if exist "backend\dist" (
    echo    Backend: Built
) else (
    echo    Backend: Not built
)

echo.

REM Environment Information
echo 🌍 Environment Information:
echo ==========================
echo    OS: Windows
echo    Architecture: %PROCESSOR_ARCHITECTURE%
echo    Shell: %COMSPEC%
echo    User: %USERNAME%
echo    Home: %USERPROFILE%

echo.

REM Memory Information
echo 🧠 Memory Information:
echo =====================
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
    set /a TOTAL_MEM_GB=%TOTAL_MEM%/1024/1024
    set /a USED_MEM_GB=%USED_MEM%/1024/1024
    set /a FREE_MEM_GB=%FREE_MEM%/1024/1024
    
    echo    Total: %TOTAL_MEM_GB%GB
    echo    Used: %USED_MEM_GB%GB
    echo    Free: %FREE_MEM_GB%GB
) else (
    echo    Memory info: Not available
)

echo.

REM Disk Information
echo 💾 Disk Information:
echo ===================
for /f "tokens=3" %%a in ('dir /-c %CD%') do (
    echo    Usage: %%a
)

echo.

REM Network Information
echo 🌐 Network Information:
echo ======================
curl --version >nul 2>&1
if %errorlevel% equ 0 (
    echo    curl: Available
) else (
    echo    curl: Not available
)

wget --version >nul 2>&1
if %errorlevel% equ 0 (
    echo    wget: Available
) else (
    echo    wget: Not available
)

echo.

REM Service Status
echo 🔍 Service Status:
echo ==================

REM Check Frontend
curl -f http://localhost:3000 >nul 2>&1
if %errorlevel% equ 0 (
    echo    Frontend: Running on http://localhost:3000
) else (
    echo    Frontend: Not running
)

REM Check Backend
curl -f http://localhost:5000/api/health >nul 2>&1
if %errorlevel% equ 0 (
    echo    Backend: Running on http://localhost:5000/api
) else (
    echo    Backend: Not running
)

REM Check Database
netstat -an | findstr :5432 >nul 2>&1
if %errorlevel% equ 0 (
    echo    Database: Running on localhost:5432
) else (
    echo    Database: Not running
)

echo.
echo 🎉 Version check completed!
echo.
pause