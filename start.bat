@echo off
REM Starts the local dev server and opens the game in your default browser.
setlocal
set PORT=3066
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to run this game.
  echo Install it from https://nodejs.org and try again.
  pause
  exit /b 1
)
start "" http://localhost:%PORT%/
node "%~dp0tools\serve.js" %PORT%
