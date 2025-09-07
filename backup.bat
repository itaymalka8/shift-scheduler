@echo off
REM Backup Script for Windows
REM This script creates a backup of the application

echo 💾 Creating Shift Scheduler Backup...
echo =====================================
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

REM Create backup directory
for /f "tokens=2 delims==" %%a in ('wmic OS Get localdatetime /value') do set "dt=%%a"
set "YY=%dt:~2,2%" & set "YYYY=%dt:~0,4%" & set "MM=%dt:~4,2%" & set "DD=%dt:~6,2%"
set "HH=%dt:~8,2%" & set "Min=%dt:~10,2%" & set "Sec=%dt:~12,2%"
set "BACKUP_DIR=backup-%YYYY%%MM%%DD%-%HH%%Min%%Sec%"

echo 📁 Creating backup directory: %BACKUP_DIR%
mkdir "%BACKUP_DIR%"

REM Backup frontend
echo 💾 Backing up frontend...
if exist "package.json" (
    copy package.json "%BACKUP_DIR%\" >nul
    copy package-lock.json "%BACKUP_DIR%\" >nul 2>&1
    xcopy src "%BACKUP_DIR%\src\" /E /I /Q >nul 2>&1
    xcopy public "%BACKUP_DIR%\public\" /E /I /Q >nul 2>&1
    copy next.config.ts "%BACKUP_DIR%\" >nul 2>&1
    copy tailwind.config.ts "%BACKUP_DIR%\" >nul 2>&1
    copy tsconfig.json "%BACKUP_DIR%\" >nul 2>&1
    echo ✅ Frontend backed up
) else (
    echo ❌ Frontend package.json not found!
)

REM Backup backend
echo 💾 Backing up backend...
if exist "backend\package.json" (
    xcopy backend "%BACKUP_DIR%\backend\" /E /I /Q >nul
    echo ✅ Backend backed up
) else (
    echo ⚠️  Backend package.json not found!
)

REM Backup configuration files
echo 💾 Backing up configuration files...
copy docker-compose.yml "%BACKUP_DIR%\" >nul 2>&1
copy Dockerfile.frontend "%BACKUP_DIR%\" >nul 2>&1
copy README.md "%BACKUP_DIR%\" >nul 2>&1
copy .gitignore "%BACKUP_DIR%\" >nul 2>&1
copy .dockerignore "%BACKUP_DIR%\" >nul 2>&1

REM Backup scripts
echo 💾 Backing up scripts...
copy *.bat "%BACKUP_DIR%\" >nul 2>&1
copy *.sh "%BACKUP_DIR%\" >nul 2>&1

echo ✅ Configuration files backed up

REM Create backup info file
echo 📝 Creating backup info...
echo Shift Scheduler Backup > "%BACKUP_DIR%\backup-info.txt"
echo ===================== >> "%BACKUP_DIR%\backup-info.txt"
echo Created: %date% %time% >> "%BACKUP_DIR%\backup-info.txt"
echo Version: Unknown >> "%BACKUP_DIR%\backup-info.txt"
echo Branch: Unknown >> "%BACKUP_DIR%\backup-info.txt"
echo Commit: Unknown >> "%BACKUP_DIR%\backup-info.txt"
echo. >> "%BACKUP_DIR%\backup-info.txt"
echo Backup Contents: >> "%BACKUP_DIR%\backup-info.txt"
echo - Frontend source code >> "%BACKUP_DIR%\backup-info.txt"
echo - Backend source code >> "%BACKUP_DIR%\backup-info.txt"
echo - Configuration files >> "%BACKUP_DIR%\backup-info.txt"
echo - Scripts >> "%BACKUP_DIR%\backup-info.txt"
echo - Documentation >> "%BACKUP_DIR%\backup-info.txt"
echo. >> "%BACKUP_DIR%\backup-info.txt"
echo To restore: >> "%BACKUP_DIR%\backup-info.txt"
echo 1. Copy files back to original locations >> "%BACKUP_DIR%\backup-info.txt"
echo 2. Run: npm install >> "%BACKUP_DIR%\backup-info.txt"
echo 3. Run: cd backend && npm install >> "%BACKUP_DIR%\backup-info.txt"
echo 4. Run: setup-database.bat >> "%BACKUP_DIR%\backup-info.txt"
echo 5. Run: start-all.bat >> "%BACKUP_DIR%\backup-info.txt"

echo ✅ Backup info created

REM Compress backup
echo 🗜️  Compressing backup...
powershell -command "Compress-Archive -Path '%BACKUP_DIR%' -DestinationPath '%BACKUP_DIR%.zip'" >nul 2>&1
if %errorlevel% equ 0 (
    rmdir /s /q "%BACKUP_DIR%"
    echo ✅ Backup compressed: %BACKUP_DIR%.zip
) else (
    echo ⚠️  Compression failed, backup not compressed
)

echo.
echo 🎉 Backup completed successfully!
echo.
echo 📊 Backup Summary:
echo    Location: %BACKUP_DIR%.zip
echo    Created: %date% %time%
echo.
echo 🔧 To restore from backup:
echo    Extract %BACKUP_DIR%.zip
echo    Copy files back to original locations
echo    Run: npm install
echo    Run: cd backend && npm install
echo.
pause