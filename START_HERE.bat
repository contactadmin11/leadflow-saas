@echo off
title LeadFlow SaaS Setup
color 0A
echo.
echo  ╔══════════════════════════════════════════════════════════╗
echo  ║         LeadFlow SaaS — Windows Quick Setup             ║
echo  ╚══════════════════════════════════════════════════════════╝
echo.

:: Check Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js not found!
    echo  Download from: https://nodejs.org (LTS version)
    pause
    exit /b 1
)

echo  [1/3] Node.js found. Installing dependencies...
cd /d "%~dp0server"
call npm install 2>&1 | findstr /v "warn"
if %errorlevel% neq 0 (
    echo  [ERROR] npm install failed.
    pause
    exit /b 1
)

echo.
echo  [2/3] Running MongoDB Setup Wizard...
echo  (You will need your MongoDB Atlas connection string)
echo.
node setup.js
if %errorlevel% neq 0 (
    echo  [ERROR] Setup failed. Check the error above.
    pause
    exit /b 1
)

echo.
echo  [3/3] Starting LeadFlow Server...
echo.
echo  ┌─────────────────────────────────────────────────┐
echo  │  App is starting at: http://localhost:3001       │
echo  │  Press Ctrl+C to stop the server                │
echo  └─────────────────────────────────────────────────┘
echo.
node src/index.js
pause
