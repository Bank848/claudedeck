@echo off
setlocal
rem launcher\ lives one level below the project root
cd /d "%~dp0.."
title ClaudeDeck (dev)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ClaudeDeck] npm was not found on your PATH.
  echo Install Node.js LTS from https://nodejs.org/ then run this again.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [ClaudeDeck] First run detected - installing dependencies...
  call npm install
  if errorlevel 1 (
    echo.
    echo [ClaudeDeck] Dependency installation failed. See the messages above.
    pause
    exit /b 1
  )
)

echo [ClaudeDeck] Starting dev mode with hot reload...
call npm run dev
if errorlevel 1 (
  echo.
  echo [ClaudeDeck] Dev server exited with an error.
  pause
)
endlocal
