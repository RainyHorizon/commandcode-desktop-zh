@echo off
chcp 65001 >nul
setlocal
title Command Code ZH Launcher

rem ===================== EDIT HERE IF NEEDED =====================
set "APP=E:\Program\CommandCode\Command Code\Command Code.exe"
set "PORT=9222"
rem ===============================================================

if not exist "%APP%" (
  echo [cczh] ERROR: app not found:
  echo        %APP%
  echo [cczh] Open this .cmd in a text editor and set APP to your Command Code.exe path.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [cczh] ERROR: Node.js not found in PATH.
  echo [cczh] Install Node.js 22 or newer first: https://nodejs.org
  pause
  exit /b 1
)

rem Command Code takes a single-instance lock. Launching a second copy would only
rem focus the existing window and ignore --remote-debugging-port, so close it first.
tasklist /fi "imagename eq Command Code.exe" 2>nul | find /i "Command Code.exe" >nul
if not errorlevel 1 (
  echo [cczh] Closing the running Command Code instance...
  taskkill /im "Command Code.exe" >nul 2>nul
  timeout /t 3 /nobreak >nul
  tasklist /fi "imagename eq Command Code.exe" 2>nul | find /i "Command Code.exe" >nul
  if not errorlevel 1 taskkill /f /im "Command Code.exe" >nul 2>nul
  timeout /t 1 /nobreak >nul
)

echo [cczh] Starting Command Code with debugging port %PORT% ...
start "" "%APP%" --remote-debugging-port=%PORT% --remote-allow-origins=*

echo [cczh] Applying Chinese localization. Keep this window open.
echo [cczh] Close this window to stop localizing (the app stays open, in English).
echo.
node "%~dp0inject.js" --port %PORT%

echo.
echo [cczh] Injector exited. The UI is back to English.
pause
