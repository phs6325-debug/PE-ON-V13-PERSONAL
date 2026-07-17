@echo off
chcp 65001 >nul
cd /d "%~dp0"
call npm install
if errorlevel 1 goto error
call npm run build
if errorlevel 1 goto error
echo Build completed.
pause
exit /b 0
:error
echo Build failed.
pause
exit /b 1
