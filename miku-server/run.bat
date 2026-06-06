@echo off
setlocal
cd /d "%~dp0"
title ClaudeDeck Miku TTS server

if not exist ".venv" (
  echo [Miku] Creating virtual environment...
  python -m venv .venv
)
call .venv\Scripts\activate

echo [Miku] Installing dependencies (first run only)...
pip install -r requirements.txt

if not exist "models\miku.pth" (
  echo.
  echo [Miku] Missing models\miku.pth
  echo Download a Hatsune Miku RVC model (.pth + .index) and put them in the models\ folder.
  echo See README.md.
  pause
  exit /b 1
)

rem Set RVC_DEVICE=cpu if you have no NVIDIA GPU (slow).
echo [Miku] Starting server on http://127.0.0.1:5050 ...
python server.py
pause
