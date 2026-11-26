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

:: --- 2. .env exists? if not, ask for the settings and write it ----------
if not exist ".env" call :create_env

:: Read back settings from .env (also covers a pre-existing .env)
set "PROJECT_NAME=athenacognis"
set "FRONT_PORT=8401"
for /f "usebackq eol=# tokens=1,2 delims==" %%A in (".env") do (
  if "%%A"=="PROJECT_NAME" set "PROJECT_NAME=%%B"
  if "%%A"=="FRONT_PORT" set "FRONT_PORT=%%B"
)

:: --- 3. Update to the latest version -------------------------------------
:: Fast-forward only: never merges or touches local edits. Offline = keep current version.
where git >nul 2>nul
if not errorlevel 1 if exist ".git" (
  echo Checking for a new version...
  git pull --ff-only
  if errorlevel 1 (
    echo Could not download the new version ^(offline, or local changes^).
    echo Starting the installed version.
  )
  echo.
)

:: --- 4. Launch detached ---------------------------------------------------
echo Starting AthenaCognis (first run can take a while while images download)...
docker compose -p "athenacognis_!PROJECT_NAME!" up -d --build
if errorlevel 1 (
  echo.
  echo docker compose failed to start the app. Check the errors above, and
  echo double-check your .env file ^(DATA_PATH, DATABASE_PASSWORD, ports^).
  pause
  exit /b 1
)

:: --- 5. Confirm it actually came up ---------------------------------------
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
  docker compose -p "athenacognis_!PROJECT_NAME!" ps
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
echo To stop it later, double-click stop.bat.
pause
exit /b 0

:: ===========================================================================
:: Subroutines
:: ===========================================================================

:create_env
echo No .env file found - let's create one.
echo Press Enter on any question to accept the default shown in [brackets].
echo.

call :ask PROJECT_NAME "Project name (letters, numbers, - or _)" "athenacognis"
for /f %%P in ('powershell -NoProfile -Command "('!PROJECT_NAME!').ToLower() -replace '[^a-z0-9_-]','-'"') do set "PROJECT_NAME=%%P"
if "!PROJECT_NAME!"=="" set "PROJECT_NAME=athenacognis"

call :ask DATA_PATH "Folder to store your data - documents, database, AI models (avoid spaces)" "%USERPROFILE%\AthenaCognisData"
call :ask LOCAL_PATH "Folder the app may read (Activity page watches folders inside it)" "%USERPROFILE%"

call :ask_port FRONT_PORT "Web interface port" 8401
call :ask_port BACK_PORT "Backend API port" 8400
call :ask_port PMA_PORT "phpMyAdmin (database UI) port" 8402

for /f %%P in ('powershell -NoProfile -Command "[guid]::NewGuid().ToString('N').Substring(0,24)"') do set "DEFAULT_DB_PASSWORD=%%P"
call :ask DATABASE_PASSWORD "Database password" "!DEFAULT_DB_PASSWORD!"

if not exist "!DATA_PATH!" mkdir "!DATA_PATH!"

(
  echo # Created by the AthenaCognis launcher. Edit and re-run the launcher to apply.
  echo # Docker Compose project name.
  echo PROJECT_NAME=!PROJECT_NAME!
  echo # Docker Hub image tag ^(Docker Hub install only^).
  echo ATHENACOGNIS_VERSION=latest
  echo.
  echo # Host folder for all persistent data ^(database, models, caches, uploads^). Back it up.
  echo DATA_PATH=!DATA_PATH!
  echo # Host folder mounted read-only at /local; the Activity page watches folders inside it.
  echo LOCAL_PATH=!LOCAL_PATH!
  echo.
  echo # Host ports: web interface, backend API, phpMyAdmin.
  echo FRONT_PORT=!FRONT_PORT!
  echo BACK_PORT=!BACK_PORT!
  echo PMA_PORT=!PMA_PORT!
  echo.
  echo # MariaDB root password. Fixed when the database is first created:
  echo # changing it later does not update an existing database.
  echo DATABASE_PASSWORD=!DATABASE_PASSWORD!
) > .env

echo.
echo .env created. Database password: !DATABASE_PASSWORD! ^(also saved in .env^)
echo.
goto :eof

:: ask VAR "Question" "default": read an answer, empty = default.
:ask
set "%~1="
set /p "%~1=%~2 [%~3]: "
if "!%~1!"=="" set "%~1=%~3"
goto :eof

:: ask_port VAR "Question" default: same, but only accepts 1-65535.
:ask_port
call :ask %1 %2 %3
set "PORT_VALUE=!%~1!"
echo !PORT_VALUE!| findstr /r "^[0-9][0-9]*$" >nul
if errorlevel 1 goto :ask_port_retry
if !PORT_VALUE! LSS 1 goto :ask_port_retry
if !PORT_VALUE! GTR 65535 goto :ask_port_retry
goto :eof
:ask_port_retry
echo   Please enter a port number between 1 and 65535.
goto :ask_port
