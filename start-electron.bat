@echo off
REM Starts the game in an Electron window (dev server starts automatically).
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to run this game.
  echo Install it from https://nodejs.org and try again.
  pause
  exit /b 1
)
pushd "%~dp0"
if not exist "node_modules\.bin\electron.cmd" (
  echo First run: installing Electron...
  call npm install --no-save electron
)
call npm run electron
popd
