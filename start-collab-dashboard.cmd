@echo off
cd /d "%~dp0"
if not exist "build\cli\collab.js" (
  echo Please run npm ci and npm run build first.
  pause
  exit /b 1
)
node build\cli\collab.js dashboard --open
if errorlevel 1 pause
