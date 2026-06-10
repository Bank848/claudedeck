@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title ClaudeDeck Miku TTS server

rem ── Writable home (venv + models). The app sets MIKU_HOME to userData\miku; for a
rem    manual run we fall back to this folder. The venv is created at an ABSOLUTE
rem    path so `call activate` can never silently fall through to a bare `python`.
if not defined MIKU_HOME set "MIKU_HOME=%~dp0"
if "%MIKU_HOME:~-1%"=="\" set "MIKU_HOME=%MIKU_HOME:~0,-1%"
if not exist "%MIKU_HOME%" mkdir "%MIKU_HOME%"
if not exist "%MIKU_HOME%\models" mkdir "%MIKU_HOME%\models"

rem ── torch wheel channel: cpu (default, works everywhere) or cu124 (NVIDIA). The
rem    app sets MIKU_TORCH from the preflight GPU probe; no more hardcoded cu124.
if not defined MIKU_TORCH set "MIKU_TORCH=cpu"
set "TORCH_INDEX=https://download.pytorch.org/whl/%MIKU_TORCH%"

rem ── Choose the interpreter that builds the venv: the app-provided embedded
rem    CPython (MIKU_PYTHON) wins; otherwise detect the system py launcher.
if not defined MIKU_PYTHON (
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
) else (
  echo [Miku] Using embedded Python: %MIKU_PYTHON%
)

if not exist "%MIKU_HOME%\.venv" (
  echo [Miku] Creating virtual environment at %MIKU_HOME%\.venv ...
  if defined MIKU_PYTHON (
    "%MIKU_PYTHON%" -m venv "%MIKU_HOME%\.venv"
  ) else (
    !PYLAUNCH! -m venv "%MIKU_HOME%\.venv"
  )
)
rem Absolute path — a bare `.venv` would depend on the cwd and could activate the
rem wrong (or no) environment.
call "%MIKU_HOME%\.venv\Scripts\activate"

echo [Miku] Installing PyTorch (%MIKU_TORCH% build, first run only)...
pip install torch torchaudio --index-url %TORCH_INDEX%

echo [Miku] Installing dependencies (first run only)...
pip install -r requirements.txt

rem Accept a model anywhere under %MIKU_HOME%\models (e.g. models\MikuAI\MikuAI.pth).
set "FOUND="
for /r "%MIKU_HOME%\models" %%F in (*.pth) do (
  if /i not "%%~nxF"=="rmvpe.pt" set "FOUND=1"
)
if not defined FOUND (
  echo.
  echo [Miku] No RVC model ^(.pth^) found under %MIKU_HOME%\models
  echo Download a Hatsune Miku RVC v2 model ^(.pth + .index^) into that folder.
  echo See README.md.
  pause
  exit /b 1
)

rem Set RVC_DEVICE=cpu if you have no NVIDIA GPU (slow).
echo [Miku] Starting server on http://127.0.0.1:5050 ...
python server.py
pause
