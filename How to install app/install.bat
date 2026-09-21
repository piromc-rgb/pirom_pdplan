@echo off
chcp 65001 >nul
title CHAKEN Planing Pro - Setup on New PC

:: Navigate to project root directory (parent folder)
cd /d "%~dp0.."
set "PROJECT_ROOT=%CD%"

echo ======================================================================
echo          CHAKEN Planing Pro - Installation for New PC
echo ======================================================================
echo Project Directory: %PROJECT_ROOT%
echo.

:: ----------------------------------------------------------------------
:: STEP 1: Check Node.js and npm
:: ----------------------------------------------------------------------
echo [1/4] Checking Node.js and npm environment...

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [INFO] Node.js is not detected on this system.
    echo [INFO] Attempting to install Node.js LTS via winget...
    echo.
    where winget >nul 2>nul
    if %errorlevel% equ 0 (
        echo Running: winget install OpenJS.NodeJS.LTS ...
        winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
        if %errorlevel% equ 0 (
            echo [INFO] Node.js installed successfully.
            set "PATH=%PATH%;C:\Program Files\nodejs;%APPDATA%\npm"
        ) else (
            echo [WARNING] winget installation returned an error.
        )
    )
    
    :: Re-check node in default directory
    where node >nul 2>nul
    if %errorlevel% neq 0 (
        if exist "C:\Program Files\nodejs\node.exe" (
            set "PATH=%PATH%;C:\Program Files\nodejs;%APPDATA%\npm"
        )
    )
    
    where node >nul 2>nul
    if %errorlevel% neq 0 (
        echo.
        echo [ERROR] Node.js could not be installed automatically!
        echo Please download and install Node.js LTS manually from:
        echo    https://nodejs.org/
        echo.
        start "" "https://nodejs.org/"
        pause
        exit /b 1
    )
)

for /f "tokens=*" %%v in ('node -v 2^>nul') do set NODE_VER=%%v
for /f "tokens=*" %%v in ('npm -v 2^>nul') do set NPM_VER=%%v
echo  - Node.js version : %NODE_VER%
echo  - npm version     : %NPM_VER%
echo.

:: ----------------------------------------------------------------------
:: STEP 2: Install project dependencies (npm install)
:: ----------------------------------------------------------------------
echo [2/4] Installing project dependencies (npm install)...
echo Please wait, this may take a few moments...
echo.

call npm install
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] npm install encountered an error!
    echo Please check your internet connection and try running 'npm install' again.
    pause
    exit /b 1
)
echo [OK] All dependencies installed successfully.
echo.

:: ----------------------------------------------------------------------
:: STEP 3: Check & initialize local data files
:: ----------------------------------------------------------------------
echo [3/4] Verifying configuration and database files...

if not exist "%PROJECT_ROOT%\Plan.json" (
    echo  - Creating default Plan.json ...
    echo {"scheduledJobs":[],"nests":{},"completedPdHistory":{},"workCenters":{},"workCenterOrder":[]} > "%PROJECT_ROOT%\Plan.json"
) else (
    echo  - Plan.json: OK
)

if not exist "%PROJECT_ROOT%\completed_pds.json" (
    echo  - Creating default completed_pds.json ...
    echo {} > "%PROJECT_ROOT%\completed_pds.json"
) else (
    echo  - completed_pds.json: OK
)

if not exist "%PROJECT_ROOT%\pd.md" (
    echo  - Initializing pd.md ...
    (
        echo # Production Order Backlog
        echo.
        echo ^| Production Order ID ^| Customer ^| Part Name ^| Qty ^| Priority ^| Target Due Date ^|
        echo ^| --- ^| --- ^| --- ^| --- ^| --- ^| --- ^|
        echo.
        echo ## Raw Data Block ^(Auto-generated^)
        echo ```json
        echo []
        echo ```
    ) > "%PROJECT_ROOT%\pd.md"
) else (
    echo  - pd.md: OK
)
echo [OK] Data files ready.
echo.

:: ----------------------------------------------------------------------
:: STEP 4: Create Desktop & Project Shortcuts
:: ----------------------------------------------------------------------
echo [4/4] Creating Desktop shortcut (CHAKEN PD Plan.lnk)...

> "%temp%\create_shortcut.vbs" (
    echo Set oWS = WScript.CreateObject("WScript.Shell"^)
    echo sDesk = oWS.SpecialFolders("Desktop"^)
    echo Set oLink = oWS.CreateShortcut(sDesk ^& "\CHAKEN PD Plan.lnk"^)
    echo oLink.TargetPath = "%PROJECT_ROOT%\start_app.bat"
    echo oLink.WorkingDirectory = "%PROJECT_ROOT%"
    echo oLink.IconLocation = "%SystemRoot%\System32\shell32.dll,220"
    echo oLink.Description = "CHAKEN Planing Pro - PD Plan"
    echo oLink.Save
    echo Set oLinkLocal = oWS.CreateShortcut("%PROJECT_ROOT%\PD Plan.lnk"^)
    echo oLinkLocal.TargetPath = "%PROJECT_ROOT%\start_app.bat"
    echo oLinkLocal.WorkingDirectory = "%PROJECT_ROOT%"
    echo oLinkLocal.IconLocation = "%SystemRoot%\System32\shell32.dll,220"
    echo oLinkLocal.Description = "CHAKEN Planing Pro - PD Plan"
    echo oLinkLocal.Save
)
cscript //nologo "%temp%\create_shortcut.vbs" >nul 2>nul
del "%temp%\create_shortcut.vbs" >nul 2>nul

echo [OK] Shortcuts created on Desktop and in project folder.
echo.

:: ----------------------------------------------------------------------
:: INSTALLATION COMPLETE
:: ----------------------------------------------------------------------
echo ======================================================================
echo           INSTALLATION COMPLETED SUCCESSFULLY!
echo ======================================================================
echo.
echo You can start the app in two ways:
echo   1. Double-click "CHAKEN PD Plan" shortcut on your Desktop
echo   2. Run "start_app.bat" in the main project directory
echo.

set "START_NOW="
set /p START_NOW="Do you want to launch the application now? (Y/N) [Y]: "
if /i "%START_NOW%"=="N" goto end
if /i "%START_NOW%"=="NO" goto end

echo.
echo Starting application...
call "%PROJECT_ROOT%\start_app.bat"
exit /b 0

:end
echo.
echo Setup finished. Enjoy using CHAKEN Planing Pro!
echo Press any key to exit setup...
pause >nul
exit /b 0
