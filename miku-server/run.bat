@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title ClaudeDeck Miku TTS server

rem ── Pick a real CPython via the py launcher (NOT the bare `python`, which may be
rem    an MSYS2/mingw build with no pip). Prefer 3.11/3.10, then 3.12/3.13.
set "PYLAUNCH="
for %%V in (3.11 3.10 3.12 3.13) do (
  if not defined PYLAUNCH (
    py -%%V -c "import sys" >nul 2>&1 && set "PYLAUNCH=py -%%V"
  )
)
if not defined PYLAUNCH (
  where py >nul 2>&1 && set "PYLAUNCH=py"
)
if not defined PYLAUNCH set "PYLAUNCH=python"
echo [Miku] Using Python launcher: !PYLAUNCH!

if not exist ".venv" (
  echo [Miku] Creating virtual environment...
  !PYLAUNCH! -m venv .venv
)
call .venv\Scripts\activate

echo [Miku] Installing PyTorch (CUDA build, first run only)...
rem If you have NO NVIDIA GPU, replace cu124 with cpu:
rem   pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124

echo [Miku] Installing dependencies (first run only)...
pip install -r requirements.txt

rem Accept a model anywhere under models\ (e.g. models\MikuAI\MikuAI.pth).
set "FOUND="
for /r "models" %%F in (*.pth) do (
  if /i not "%%~nxF"=="rmvpe.pt" set "FOUND=1"
)
if not defined FOUND (
  echo.
  echo [Miku] No RVC model ^(.pth^) found under models\
  echo Download a Hatsune Miku RVC v2 model ^(.pth + .index^) into the models\ folder.
  echo See README.md.
  pause
  exit /b 1
)

rem Set RVC_DEVICE=cpu if you have no NVIDIA GPU (slow).
echo [Miku] Starting server on http://127.0.0.1:5050 ...
python server.py
pause
