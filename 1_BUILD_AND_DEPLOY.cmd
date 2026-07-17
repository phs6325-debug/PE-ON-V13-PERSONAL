@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo [PE-ON V13] Building offline PWA...
call npm install
if errorlevel 1 goto error
call npm run build
if errorlevel 1 goto error
echo.
echo Build complete. Deploying to Firebase Hosting...
call firebase deploy --only hosting
if errorlevel 1 goto error
echo.
echo Completed successfully.
pause
exit /b 0
:error
echo.
echo An error occurred. Review the message above.
pause
exit /b 1
