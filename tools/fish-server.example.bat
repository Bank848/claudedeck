@echo off
rem ============================================================================
rem  ClaudeDeck — local voice (fish-speech / OpenAudio) server launcher
rem ----------------------------------------------------------------------------
rem  To make ClaudeDeck auto-start your voice server in the background:
rem    1. Copy this file to  tools\fish-server.bat
rem    2. Edit the paths below to match your fish-speech install + checkpoints
rem    3. Run start-dev.bat (or start.bat) — the server starts automatically
rem
rem  It must listen on the same URL set in Settings -> Voice output engine
rem  (default http://127.0.0.1:8080).
rem ============================================================================

rem --- EDIT THESE ---
set FISH_DIR=C:\path\to\fish-speech
set PYTHON=python

cd /d "%FISH_DIR%"
%PYTHON% tools\api_server.py ^
  --llama-checkpoint-path checkpoints\openaudio-s1-mini ^
  --decoder-checkpoint-path checkpoints\openaudio-s1-mini\codec.pth ^
  --listen 0.0.0.0:8080
