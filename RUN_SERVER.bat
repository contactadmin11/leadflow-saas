@echo off
title LeadFlow — Running
color 0B
cd /d "%~dp0server"
echo.
echo  LeadFlow Server starting...
echo  Open: http://localhost:3001
echo.
node src/index.js
pause
