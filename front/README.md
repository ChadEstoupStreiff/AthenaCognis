# AthenaCognis — web front (`front`)

The AthenaCognis web UI, built with **Angular 21 + PrimeNG 21**. It talks to the FastAPI backend
for database, files, settings and AI jobs.

`front` is **UI only**: a static build served by nginx. There is no Node server and no login.
The backend is meant to run on a local network; add authentication to FastAPI if you ever need it.

```
browser ──► nginx (front container, :8401)
              ├── /            static Angular build (SPA fallback)
              ├── /api/*    ─► back:80        FastAPI (raw, still-encoded URIs)
              ├── /raw/*    ─► /shared (ro)   inline files, Range requests (video seeking, PDF)
              ├── /grobid/* ─► grobid:8070    paper metadata extraction (Research)
              ├── /arxiv/*  ─► export.arxiv.org (no CORS upstream)
              ├── /telemetry/* ─► TELEMETRY_SERVER_URL (optional)
              └── /config.json  written at start from USER_NAME / TELEMETRY_* env
```

CrossRef, PubMed and OpenAlex are called straight from the browser (they allow CORS).

## Run with Docker

From the repository root (the service is defined in `docker-compose.yml`):

```bash
docker compose up -d --build front
```

Open `http://localhost:${FRONT_PORT}` (default `8401`). Environment used by the container:

| Variable                                          | Purpose                                                          |
| ------------------------------------------------- | ---------------------------------------------------------------- |
| `FRONT_PORT`                                      | Host port (default `8401`)                                       |
| `DATA_PATH`                                       | Its `shared/` folder is mounted read-only at `/shared`           |
| `USER_NAME`                                       | Greeting on Home                                                 |
| `TELEMETRY_SERVER_URL`, `TELEMETRY_DASHBOARD_URL` | Optional anonymous statistics (consent required, one ping a day) |
| `BACKEND_HOST`, `GROBID_HOST`                     | Image defaults `back:80`, `grobid:8070`                          |

## Develop

Node 24 is required (`brew install node@24`, then `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"`).

```bash
cd front
npm ci
BACKEND_URL=http://localhost:8400 npm start   # ng serve on :4200, proxies like nginx (proxy.conf.mjs)
```

| Script           | What it does                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| `npm start`      | Dev server with the same `/api`, `/raw`, `/arxiv`, `/telemetry` proxies                            |
| `npm run build`  | Production build into `dist/web/browser`                                                           |
| `npm run check`  | Prettier check, ESLint (zero warnings), template type check, unit tests — must pass before merging |
| `npm test`       | Vitest unit tests (domain logic, ported Python tests, services)                                    |
| `npm run e2e`    | Playwright smoke tests (`E2E_BASE_URL`, default `http://localhost:8401`)                           |
| `npm run format` | Prettier write                                                                                     |

### Smoke tests and real data

The e2e smoke tests are **read-only by default**: every non-GET call to `/api`, telemetry and
external hosts used by Research are blocked, so they can run against a stack holding real data.
Set `E2E_ALLOW_WRITES=1` only against a throwaway stack.

## Code layout

```
src/app/
  domain/    Pure TypeScript logic, no Angular: contracts, mappers, file naming, search,
             time, colors, and the Research library (domain/sota: difflib SequenceMatcher port,
             GROBID TEI / CrossRef / PubMed / arXiv / OpenAlex mappers, BibTeX & RIS, import plan,
             citation graph).
  core/      Services: ApiClient, files (uploads, previews, relations), search stream, jobs,
             settings, chat, telemetry, SOTA storage and online sources, layout (shell, palette).
  shared/    Reusable UI: file collection/peek/renderers, search panel, markdown, charts, graph.
  features/  Pages: home, library, viewer, notes, time, work, projects, people, research,
             assistant, settings, capture (upload, voice memo).
```

## Pages

| Page                                    | Notes                                                                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Home (Today + Insights)                 | Hours vs target, today's files/events, tasks due, pinned, recents, KPIs                                                                                |
| Library                                 | Search bar with collapsible filters (in the URL), streaming results, cards/list/table, bulk actions, file side panel                                   |
| Viewer `/f/:date/:folder/:name`         | Every renderer; HTML, SVG and Markdown switch Rendered / Source; inspector (info, AI, links graph, notes, people); side panel on click/Space           |
| Notes                                   | CodeMirror + live preview, autosave, AI assist                                                                                                         |
| Upload dialog, drop anywhere, `/upload` | Conflict-safe naming                                                                                                                                   |
| Voice memo dock                         | Keeps recording while you navigate                                                                                                                     |
| Time                                    | Month grid, day drawer, progress banner, statistics                                                                                                    |
| Work                                    | Kanban drag & drop, task details (Edit opens the form), dependencies, calendar and timeline views                                                      |
| Projects                                | Hub: overview/notes/TODO, files, time, people, tasks                                                                                                   |
| People                                  | Master–detail, photo, notes, linked files                                                                                                              |
| Research                                | Library, field-by-field review of found metadata, Cite (APA/Vancouver/BibTeX), citation & AI relation map, Zotero RIS/BibTeX import & export with PDFs |
| Assistant                               | Sessions, live answers, file and time-entry attachments, presets, RAG toggle, stop/retry                                                               |
| Settings                                | One searchable page: appearance, AI routing, keys (with check), Ollama, assistant, processing, jobs, tags, telemetry                                   |

Global: command palette (⌘K / Ctrl+K), `+ New` menu, shortcuts (`/` search, `g` + letter to
navigate, `u` upload, `v` voice), jobs indicator (a runner at rest; runs, swims and cycles while
jobs are busy), Markdown rendered in every summary, description, comment and chat message (text
areas have a Preview toggle), light/dark/system theme.

## Backend quirks handled in the front

- File paths travel as one encoded segment (`%2Fshared%2F…`); nginx forwards the raw URI so slashes are not merged.
- Long texts (notes, project notes) go in query strings: nginx allows 2 MB headers.
- Uploads never overwrite a file that has relations (the backend would delete it); names are predicted first.
- HTML, SVG and XML from `/raw` are served with `Content-Security-Policy: sandbox` (opaque origin, no scripts). The viewer's "Run scripts" loads `?scripts=1`, which adds `allow-scripts` for HTML only: the page runs isolated from the app, but like any web page it could still send requests to the unauthenticated backend.
- Deletes and moves also clean recents, pins and Research keys.
- A missing stockpile key answers an empty 500: treated as "no value".
- Summaries of images/audio wait for OCR/transcription before being queued.
