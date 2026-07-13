![AthenaCognis banner](https://raw.githubusercontent.com/ChadEstoupStreiff/athenacognis/main/assets/banner.png)

# AthenaCognis

![Document Management](https://img.shields.io/badge/Document_Management-555?style=flat-square)
![Knowledge Base](https://img.shields.io/badge/Knowledge_Base-555?style=flat-square)
![AI Extraction](https://img.shields.io/badge/AI_Extraction-555?style=flat-square)
![Full-text Search](https://img.shields.io/badge/Full--text_Search-555?style=flat-square)
![Task Management](https://img.shields.io/badge/Task_Management-555?style=flat-square)
![Research Bibliography](https://img.shields.io/badge/Research_Bibliography-555?style=flat-square)
![Time Tracking](https://img.shields.io/badge/Time_Tracking-555?style=flat-square)
![Note-taking](https://img.shields.io/badge/Note--taking-555?style=flat-square)

![Self-Hosted](https://img.shields.io/badge/Self--Hosted-2ea44f?style=flat-square)
![Local AI](https://img.shields.io/badge/Local_AI-7B2FBE?style=flat-square)
![Open Source](https://img.shields.io/badge/Open_Source-%E2%9D%A4-e05d44?style=flat-square)
![MIT License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)

**AthenaCognis** is a self-hosted, AI-powered document management and knowledge
assistant. Inspired by tools like *Paperless*, it combines full-text search,
multi-provider AI extraction, project and task management, research bibliography
tools, and productivity tracking, all in one web application that keeps your data
on your own infrastructure.

Source, issue tracker, and full documentation:
[github.com/ChadEstoupStreiff/athenacognis](https://github.com/ChadEstoupStreiff/athenacognis)

## About these images

AthenaCognis runs as two custom images working together, plus off-the-shelf
`mariadb`, `phpmyadmin`, and `ollama` containers. You need **both** custom images
to run the app:

| Image | Role |
|-------|------|
| `chadesdev/athenacognis-back` | FastAPI REST API, background AI daemons (OCR, transcription, summarisation, embeddings, chat), file management |
| `chadesdev/athenacognis-front` | Streamlit web UI |

Tags: `latest` (newest build) or a pinned version, e.g. `1.0.0`.

## Quick start

Create a folder with a `docker-compose.yml` and a `.env` file, then run
`docker compose up -d`. Full instructions, the `.env` template, and the complete
`docker-compose.yml` are in
[DEPLOYMENT.md](https://github.com/ChadEstoupStreiff/athenacognis/blob/main/DEPLOYMENT.md).

Minimal shape of the two custom services in `docker-compose.yml`:

```yaml
services:
  back:
    image: chadesdev/athenacognis-back:latest
    restart: unless-stopped
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

  front:
    image: chadesdev/athenacognis-front:latest
    restart: unless-stopped
    depends_on:
      - back
    ports:
      - "${FRONT_PORT}:8501"
    volumes:
      - .env:/.env
```

(`back_db`, `pma`, and `ollama` services and the rest of `.env` are covered in
[DEPLOYMENT.md](https://github.com/ChadEstoupStreiff/athenacognis/blob/main/DEPLOYMENT.md).)

## Tech stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3, FastAPI, SQLAlchemy |
| Frontend | Streamlit |
| Database | MariaDB 10.6 |
| Local LLM inference | Ollama |
| Cloud AI | OpenAI, Mistral AI, Google Gemini, Groq, Anthropic Claude |
| OCR | PaddleOCR |
| Transcription | Faster-Whisper (local), OpenAI Whisper API, Groq |

## License

MIT License © Chad Estoup-Streiff
