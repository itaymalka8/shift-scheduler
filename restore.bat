@echo off
REM Restore Script for Windows
REM This script restores the application from a backup

echo 🔄 Restoring Shift Scheduler from Backup...
echo ===========================================
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

REM List available backups
echo 📋 Available backups:
dir backup-*.zip /b 2>nul
if %errorlevel% neq 0 (
    echo ❌ No backup files found!
    echo    Please ensure backup files are in the current directory
    pause
    exit /b 1
)

echo.

REM Select backup
echo 🔍 Please enter the backup filename to restore:
set /p BACKUP_FILE="Backup filename: "

if not exist "%BACKUP_FILE%" (
    echo ❌ Backup file not found: %BACKUP_FILE%
    pause
    exit /b 1
)

echo.
echo 📁 Selected backup: %BACKUP_FILE%
echo.

REM Confirm restore
echo ⚠️  This will restore the application from backup.
echo    This will overwrite existing files.
echo.
set /p confirm="Are you sure you want to continue? (y/N): "

if /i not "%confirm%"=="y" (
    echo ❌ Restore cancelled
    pause
    exit /b 0
)

echo.
echo 🔄 Starting restore...

REM Extract backup
echo 📦 Extracting backup...
powershell -command "Expand-Archive -Path '%BACKUP_FILE%' -DestinationPath '.' -Force" >nul 2>&1
if %errorlevel% equ 0 (
    set "BACKUP_DIR=%BACKUP_FILE:.zip=%"
    echo ✅ Backup extracted to: %BACKUP_DIR%
) else (
    echo ❌ Failed to extract backup
    pause
    exit /b 1
)

REM Restore files
echo 📁 Restoring files...
if exist "%BACKUP_DIR%" (
    REM Restore frontend
    if exist "%BACKUP_DIR%\package.json" (
        copy "%BACKUP_DIR%\package.json" . >nul
        copy "%BACKUP_DIR%\package-lock.json" . >nul 2>&1
        xcopy "%BACKUP_DIR%\src" src\ /E /I /Q >nul 2>&1
        xcopy "%BACKUP_DIR%\public" public\ /E /I /Q >nul 2>&1
        copy "%BACKUP_DIR%\next.config.ts" . >nul 2>&1
        copy "%BACKUP_DIR%\tailwind.config.ts" . >nul 2>&1
        copy "%BACKUP_DIR%\tsconfig.json" . >nul 2>&1
        echo ✅ Frontend files restored
    )

    REM Restore backend
    if exist "%BACKUP_DIR%\backend" (
        xcopy "%BACKUP_DIR%\backend" backend\ /E /I /Q >nul
        echo ✅ Backend files restored
    )

    REM Restore configuration files
    copy "%BACKUP_DIR%\docker-compose.yml" . >nul 2>&1
    copy "%BACKUP_DIR%\Dockerfile.frontend" . >nul 2>&1
    copy "%BACKUP_DIR%\README.md" . >nul 2>&1
    copy "%BACKUP_DIR%\.gitignore" . >nul 2>&1
    copy "%BACKUP_DIR%\.dockerignore" . >nul 2>&1

    REM Restore scripts
    copy "%BACKUP_DIR%\*.bat" . >nul 2>&1
    copy "%BACKUP_DIR%\*.sh" . >nul 2>&1

    echo ✅ Configuration files restored
) else (
    echo ❌ Backup directory not found: %BACKUP_DIR%
    pause
    exit /b 1
)

REM Clean up extracted files
echo 🧹 Cleaning up...
rmdir /s /q "%BACKUP_DIR%"
echo ✅ Cleanup completed

REM Reinstall dependencies
echo 📦 Reinstalling dependencies...

REM Frontend
echo 📦 Installing frontend dependencies...
npm install
echo ✅ Frontend dependencies installed

REM Backend
echo 📦 Installing backend dependencies...
cd backend
npm install
cd ..
echo ✅ Backend dependencies installed

echo.
echo 🎉 Restore completed successfully!
echo.
echo 📊 Restore Summary:
echo    Backup: %BACKUP_FILE%
echo    Frontend: Restored and reinstalled
echo    Backend: Restored and reinstalled
echo.
echo 🚀 To start the application:
echo    start-all.bat
echo    Or: start-docker.bat
echo.
pause