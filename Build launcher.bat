@echo off
rem Builds the Windows installer and the portable zip from the code in this folder.
rem Needs Node.js (https://nodejs.org). Only needed to build, not to play.
rem They appear in the "dist" folder, which opens when it is done.
cd /d "%~dp0"
rem Fetches any libraries that are missing or new (quick when nothing changed).
call npm install --no-audit --no-fund
echo.
echo Building... this takes a few minutes the first time.
echo.
call npm run dist
if errorlevel 1 (
  echo.
  echo Something went wrong. Send Claude a screenshot of this window.
  pause
  exit /b 1
)
explorer dist
echo.
echo Done! Run "Game Launcher Setup" to install or update, or unzip the portable zip anywhere.
pause
