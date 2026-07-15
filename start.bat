@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo === AthenaCognis launcher ===
echo.

:: --- 1. Docker installed? ------------------------------------------------
where docker >nul 2>nul
if errorlevel 1 (
  echo Docker was not found on this system.
  echo Opening the Docker Desktop download page in your browser...
  start "" "https://www.docker.com/products/docker-desktop/"
  echo Install Docker Desktop, then run this script again.
  pause
  exit /b 1
)

docker info >nul 2>nul
if errorlevel 1 (
  echo Docker is installed but not running. Start Docker Desktop and try again.
  pause
  exit /b 1
)

:: --- 2. .env exists? if not, ask for the important settings --------------
if not exist ".env" (
  echo No .env file found - let's create one.
  echo Press Enter on any question to accept the default shown in [brackets].
  echo.

  set "PROJECT_NAME="
  set /p "PROJECT_NAME=Project name (letters, numbers, - or _) [athenacognis]: "
  if "!PROJECT_NAME!"=="" set "PROJECT_NAME=athenacognis"
  for /f %%P in ('powershell -NoProfile -Command "('!PROJECT_NAME!').ToLower() -replace '[^a-z0-9_-]','-'"') do set "PROJECT_NAME=%%P"
  if "!PROJECT_NAME!"=="" set "PROJECT_NAME=athenacognis"

  set "DEFAULT_USER_NAME=%USERNAME%"
  set "USER_NAME="
  set /p "USER_NAME=Your name (shown in the app) [!DEFAULT_USER_NAME!]: "
  if "!USER_NAME!"=="" set "USER_NAME=!DEFAULT_USER_NAME!"

  set "DEFAULT_DATA_PATH=%USERPROFILE%\AthenaCognisData"
  set "DATA_PATH="
  set /p "DATA_PATH=Folder to store your data - documents, database, AI models (avoid spaces) [!DEFAULT_DATA_PATH!]: "
  if "!DATA_PATH!"=="" set "DATA_PATH=!DEFAULT_DATA_PATH!"

  set "BACK_PORT="
  set /p "BACK_PORT=Backend port [8400]: "
  if "!BACK_PORT!"=="" set "BACK_PORT=8400"

  set "FRONT_PORT="
  set /p "FRONT_PORT=Frontend (web UI) port [8401]: "
  if "!FRONT_PORT!"=="" set "FRONT_PORT=8401"

  set "PMA_PORT="
  set /p "PMA_PORT=phpMyAdmin port [8402]: "
  if "!PMA_PORT!"=="" set "PMA_PORT=8402"

  for /f %%P in ('powershell -NoProfile -Command "[guid]::NewGuid().ToString('N').Substring(0,24)"') do set "DEFAULT_DB_PASSWORD=%%P"
  set "DATABASE_PASSWORD="
  set /p "DATABASE_PASSWORD=Database password [random: !DEFAULT_DB_PASSWORD!]: "
  if "!DATABASE_PASSWORD!"=="" set "DATABASE_PASSWORD=!DEFAULT_DB_PASSWORD!"

  set "APP_PWD="
  set /p "APP_PWD=Password to protect the web UI (leave blank for none): "

  if not exist "!DATA_PATH!" mkdir "!DATA_PATH!"

  (
    echo PROJECT_NAME=!PROJECT_NAME!
    echo USER_NAME=!USER_NAME!
    echo ATHENACOGNIS_VERSION=latest
    echo.
    echo DATA_PATH=!DATA_PATH!
    echo BACK_PORT=!BACK_PORT!
    echo FRONT_PORT=!FRONT_PORT!
    echo PMA_PORT=!PMA_PORT!
    echo.
    echo DATABASE_PASSWORD=!DATABASE_PASSWORD!
    echo.
    echo APP_PWD=!APP_PWD!
    echo LOGIN_TIMEOUT=86400
    echo.
    echo TELEMETRY_SERVER_URL=https://telemetryathenacognis.chades.fr
    echo TELEMETRY_DASHBOARD_URL=https://athenacognis.chades.fr
  ) > .env

  echo.
  echo .env created. Database password: !DATABASE_PASSWORD! ^(also saved in .env^)
  echo.
)

:: Read back settings from .env (also covers a pre-existing .env)
set "PROJECT_NAME=athenacognis"
set "FRONT_PORT=8401"
for /f "usebackq eol=# tokens=1,2 delims==" %%A in (".env") do (
  if "%%A"=="PROJECT_NAME" set "PROJECT_NAME=%%B"
  if "%%A"=="FRONT_PORT" set "FRONT_PORT=%%B"
)

:: --- 3. Launch detached ---------------------------------------------------
echo Starting AthenaCognis (first run can take a while while images download)...
docker compose -p "superdiary_!PROJECT_NAME!" up -d --build
if errorlevel 1 (
  echo.
  echo docker compose failed to start the app. Check the errors above, and
  echo double-check your .env file ^(DATA_PATH, DATABASE_PASSWORD, ports^).
  pause
  exit /b 1
)

:: --- 4. Confirm it actually came up ---------------------------------------
set "URL=http://localhost:!FRONT_PORT!"
echo Waiting for AthenaCognis to come up at !URL! ...

set "READY=0"
for /l %%i in (1,1,60) do (
  if "!READY!"=="0" (
    curl -sf "!URL!" >nul 2>nul
    if not errorlevel 1 (
      set "READY=1"
    ) else (
      timeout /t 2 >nul
    )
  )
)

if "!READY!"=="0" (
  echo.
  echo AthenaCognis did not come up at !URL! in time. Current container status:
  docker compose -p "superdiary_!PROJECT_NAME!" ps
  echo.
  echo Something is likely wrong - check your .env file ^(DATA_PATH, DATABASE_PASSWORD,
  echo or a port already in use^), and see the logs with:
  echo   docker compose logs -f
  pause
  exit /b 1
)

start "" "!URL!"

echo.
echo AthenaCognis is running at !URL!
echo Closing this window will NOT stop the app - it keeps running in the background.
echo To stop it later, run: docker compose down
pause
