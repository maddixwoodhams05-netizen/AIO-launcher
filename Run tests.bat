@echo off
rem Runs the automatic tests. Launcher windows will flash open and closed, that is normal.
rem Needs Node.js (https://nodejs.org).
cd /d "%~dp0"
if not exist node_modules\playwright-core call npm install --no-audit --no-fund
call npm test
pause
