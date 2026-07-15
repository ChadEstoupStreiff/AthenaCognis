# Deploying AthenaCognis with Docker

AthenaCognis ships as prebuilt images on Docker Hub. You do **not** need to clone the
source repository — just the two files below and Docker.

## Prerequisites

- [Docker](https://docs.docker.com/engine/install/) and [Docker Compose](https://docs.docker.com/compose/install/)
- At least **8 GB RAM** allocated to Docker
- A storage path on your host for persistent data (files, database, AI model caches)

> A GPU is optional. The app runs on CPU alone; local AI tasks (OCR, transcription,
> summarisation) will simply be slower.

## 1. Create a project folder

```bash
mkdir athenacognis && cd athenacognis
```

## 2. Add `docker-compose.yml`

```yaml
services:
  back_db:
    image: mariadb:10.6
    container_name: back_db
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: ${DATABASE_PASSWORD}
      MYSQL_DATABASE: superdiary
    volumes:
      - ${DATA_PATH}/back/db:/var/lib/mysql
    hostname: back_db
    networks:
      - appnet

  pma:
    image: phpmyadmin/phpmyadmin:latest
    container_name: pma
    restart: unless-stopped
    environment:
      PMA_HOST: back_db
      PMA_USER: root
      PMA_PASSWORD: ${DATABASE_PASSWORD}
    ports:
      - "${PMA_PORT}:80"
    hostname: pma
    networks:
      - appnet

  ollama:
    image: docker.io/ollama/ollama:latest
    container_name: ollama
    restart: unless-stopped
    environment:
      - OLLAMA_KEEP_ALIVE=1h
      - OLLAMA_HOST=0.0.0.0
    volumes:
      - ${DATA_PATH}/ollama:/root/.ollama
    deploy:
      resources:
        limits:
          cpus: '4.'
    tty: true
    hostname: ollama
    networks:
      - appnet

  back:
    image: chadesdev/athenacognis-back:${ATHENACOGNIS_VERSION:-latest}
    container_name: back
    restart: unless-stopped
    deploy:
      resources:
        limits:
          cpus: '4.'
    volumes:
      - ${DATA_PATH}/shared:/shared
      - .env:/.env
      - ${DATA_PATH}/whisper_cache:/root/.cache
      - ${DATA_PATH}/paddle:/root/.paddle
      - ${DATA_PATH}/paddleocr:/root/.paddleocr
      - ${DATA_PATH}/ollama:/ollama
      - ${DATA_PATH}/back/db:/mysql
    depends_on:
      - back_db
    ports:
      - "${BACK_PORT}:80"
    hostname: back
    networks:
      - appnet

  front:
    image: chadesdev/athenacognis-front:${ATHENACOGNIS_VERSION:-latest}
    container_name: front
    restart: unless-stopped
    depends_on:
      - back
    ports:
      - "${FRONT_PORT}:8501"
    volumes:
      - .env:/.env
    hostname: front
    networks:
      - appnet

networks:
  appnet:
    driver: bridge
```

## 3. Add `.env`

Create a `.env` file next to `docker-compose.yml`:

```dotenv
# Absolute path on the host for all persistent data (files, database, models, caches)
DATA_PATH=/data/athenacognis

# Host ports
BACK_PORT=8400
FRONT_PORT=8401
PMA_PORT=8402

# MariaDB root password
DATABASE_PASSWORD=change_me

# Optional: protect the web UI with a password (leave empty to disable)
APP_PWD=
LOGIN_TIMEOUT=86400

# Optional: pin a specific release instead of always pulling :latest
ATHENACOGNIS_VERSION=latest
```

Fill in `DATA_PATH` with a real path on your host (it will be created if it doesn't
exist) and set a strong `DATABASE_PASSWORD`.

## 4. Start the application

```bash
docker compose up -d
```

Docker will pull the images from Docker Hub on first run. The frontend will be
available at `http://localhost:<FRONT_PORT>` (e.g. `http://localhost:8401`).

## 5. (Optional) Double-click launcher instead of steps 3 & 4

If you'd rather not hand-write `.env` or type Docker commands, grab the
launcher script for your OS and drop it in the same folder as
`docker-compose.yml`:

| File | Platform | Download |
|------|----------|----------|
| `start.sh` | Linux | [raw link](https://raw.githubusercontent.com/ChadEstoupStreiff/athenacognis/main/start.sh) |
| `start.command` | macOS | [raw link](https://raw.githubusercontent.com/ChadEstoupStreiff/athenacognis/main/start.command) |
| `start.bat` | Windows | [raw link](https://raw.githubusercontent.com/ChadEstoupStreiff/athenacognis/main/start.bat) |

```bash
# Linux / macOS example
curl -fsSL -o start.sh https://raw.githubusercontent.com/ChadEstoupStreiff/athenacognis/main/start.sh
chmod +x start.sh
```

Double-clicking it will:

1. Check Docker is installed — if not, open the Docker download page for you.
2. Check for `.env` — if it's missing (skipping steps 3 above), ask a few
   questions (data folder, ports, database password — press Enter to accept
   the defaults) and write it for you.
3. Start the stack detached (`docker compose up -d`).
4. Wait for it to come up and open `http://localhost:<FRONT_PORT>` in your
   browser. If it doesn't come up in time, it tells you something's wrong
   and to check `.env` and the container logs.

Closing the window afterwards does **not** stop the app — see
[Stopping](#stopping) below.

> **Linux note:** most file managers won't run a `.sh` file on double-click
> until it's marked executable and "allowed to run as a program" (Properties
> → Permissions, varies by desktop environment).

## 6. (Optional) Pull a local LLM model

Go to **Settings → LLM Settings → Local Llama**, enter a model name (e.g.
`llama3.2:8b`) and click **Pull Model**. Browse available models at
[ollama.com/library](https://ollama.com/library).

## Updating

```bash
docker compose pull
docker compose up -d
```

Set `ATHENACOGNIS_VERSION` in `.env` to pin to a specific release, or leave it as
`latest` to always get the newest build.

## Stopping

```bash
docker compose down
```

Your data stays on disk under `DATA_PATH` and is untouched by `down`.

## Data & backups

Everything persistent lives under `DATA_PATH` on the host:

| Path | Contents |
|------|----------|
| `DATA_PATH/back/db` | MariaDB data files |
| `DATA_PATH/shared` | Uploaded documents and generated previews |
| `DATA_PATH/ollama` | Local LLM models |
| `DATA_PATH/whisper_cache`, `DATA_PATH/paddle`, `DATA_PATH/paddleocr` | Model caches for transcription/OCR |

Back up `DATA_PATH` to back up the whole application.

## Troubleshooting

- **Port already in use**: change `BACK_PORT` / `FRONT_PORT` / `PMA_PORT` in `.env`.
- **Containers keep restarting**: check logs with `docker compose logs -f back`.
- **Out of memory**: local AI tasks (OCR, transcription, embeddings) are memory
  hungry; make sure Docker has at least 8 GB RAM available.
