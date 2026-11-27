@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
:: Double-click stopper for AthenaCognis (Windows).
:: Stops and removes the app containers. Your data (DATA_PATH) is kept.

echo === AthenaCognis stopper ===
echo.

docker info >nul 2>nul
if errorlevel 1 (
  echo Docker is not installed or not running - nothing to stop.
  pause
  exit /b 1
)

set "PROJECT_NAME=athenacognis"
if exist ".env" (
  for /f "usebackq eol=# tokens=1,2 delims==" %%A in (".env") do (
    if "%%A"=="PROJECT_NAME" set "PROJECT_NAME=%%B"
  )
)
set "PROJECT=athenacognis_!PROJECT_NAME!"

echo Stopping AthenaCognis ^(!PROJECT!^)...
docker compose -p "!PROJECT!" down
if errorlevel 1 (
  echo.
  echo docker compose failed to stop the app. Check the errors above.
  pause
  exit /b 1
)

echo.
echo AthenaCognis is stopped. Your data is kept; start it again with the launcher.
pause
exit /b 0
