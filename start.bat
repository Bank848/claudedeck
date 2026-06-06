@echo off
setlocal
cd /d "%~dp0"
title ClaudeDeck

where npm >nul 2>nul
if errorlevel 1 (
  echo [ClaudeDeck] npm was not found on your PATH.
  echo Install Node.js LTS from https://nodejs.org/ then run this again.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [ClaudeDeck] First run detected - installing dependencies.
  echo This can take a few minutes...
  call npm install
  if errorlevel 1 (
    echo.
    echo [ClaudeDeck] Dependency installation failed. See the messages above.
    pause
    exit /b 1
  )
)

if not exist "out\main\index.js" (
  echo [ClaudeDeck] Building the app...
  call npm run build
  if errorlevel 1 (
    echo.
    echo [ClaudeDeck] Build failed. See the messages above.
    pause
    exit /b 1
  )
)

rem Auto-start any local backend (e.g. fish-speech) in the background if configured.
if exist "tools\fish-server.bat" (
  echo [ClaudeDeck] Starting local voice server in background...
  start "ClaudeDeck voice server" /min cmd /c "tools\fish-server.bat"
)

echo [ClaudeDeck] Launching...
call npm run start
if errorlevel 1 (
  echo.
  echo [ClaudeDeck] The app exited with an error.
  pause
)
endlocal
