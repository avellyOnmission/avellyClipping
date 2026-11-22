@echo off
title avelly - AI Clip Engine
cd /d "%~dp0"

echo ==========================================================
echo                   AVELLY - AI CLIP ENGINE
echo ==========================================================
echo.
echo  [+] Starting local server on http://127.0.0.1:8770
echo  [+] Launching your web browser...
echo.

:: Wait 1 second and open browser
start "" http://127.0.0.1:8770

:: Run the local server
.venv\Scripts\python.exe app.py

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [!] Server encountered an error.
    pause
)
