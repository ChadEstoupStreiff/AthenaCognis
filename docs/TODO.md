
Ideas:
- Add MCP systeme
- Add RAG systeme to let AI use and learn from data -> goal of custom AI for better research
- Summaries should cites their fact to the document
- Auto rewrite bibtext export on a targeted file

- Un vrai index vectoriel. La recherche recharge aujourd'hui tous les vecteurs stockés en JSON à chaque requête, ce qui ne tiendra pas au-delà de quelques milliers de fichiers.
- Sauvegarde et export en un clic. Héberger soi-même ses données, c'est aussi être responsable de leur sauvegarde. Export import de parametres d'application, BD, fichiers etc en 1 zip.
- in mail add boxes/folders

Bugs:


Opti:
- Add a setting "Max token text size" for auto summary, same for OCR etc

Offer hosted for you service at 3.99:

App is single-user (no auth, one DB per stack), so one full stack per
  user is the right model. It's not plug-and-play yet, though. Here's what I found in the compose
  file and backend code.

  Architecture

  user → authentik (forward auth) → Traefik/Caddy → route by user → front-<user> / back-<user> → 
  back_db-<user> ↘ shared: ollama, grobid

  - Use forward auth on the proxy (Traefik forwardAuth or Caddy forward_auth). Authentik sets the
    X-authentik-username header, and the proxy routes on it, or on a per-user subdomain
    (alice.app.tld). Subdomains are simpler and avoid mixing cookies between users.
  - Generate one compose project per user (docker compose -p user_alice) from a template, with its
    own .env and its own DATA_PATH.
  - The backend must never be reachable without going through authentik. Today the backend API is
    fully open, so anyone who reaches it has full access.

  Blockers in the current code

  1. Shared Ollama, model management. views/ollama.py:73 exposes DELETE /delete/{model} and POST
     /pull/{model} to every instance. Any user could delete models the others depend on, or fill
     the disk with pulls. Either make these admin-only (a flag in .env, routes disabled when it's
     off) or block /api/pull and /api/delete in a proxy placed in front of Ollama.
  2. Ollama capacity. Ollama runs one queue with limited parallelism (OLLAMA_NUM_PARALLEL). When N
     users generate at once, latency grows with N. Each user's custom num_ctx also forces a model
     reload, so the cache thrashes between users. Pin the model list and num_ctx server-side.
  3. Backend weight per tenant. Each backend image bundles torch, faster_whisper, paddleocr,
     qwen-asr and BLIP, which is several GB of RAM per user once loaded, plus a 4-CPU limit. This
     is the real cost driver. Move transcription and OCR into a shared worker service like grobid,
     or load models lazily and unload them after an idle timeout.
  4. Host-only features.
     - LOCAL_PATH → /local and ActivityWatch at host.docker.internal:5600 read the server's files
       and host. In hosted mode they must be disabled, or replaced with an upload or agent push.
     - .git mount + update_check.py: drop it, you control updates.
     - pma with a root password on a published port: remove per tenant.
  5. MariaDB per user. Works, but costs about 100–200 MB idle each. An alternative is one MariaDB
     server with one database and one DB user per tenant. That's cheaper and needs no code change
     beyond DATABASE_* in .env.
  6. Secrets. Users enter their LLM API keys (OpenAI, Anthropic, etc.) and Exchange credentials,
     and you store them. Encrypt at rest, and handle the GDPR side (privacy policy, data export,
     account deletion).
  7. Grobid. Fine to share: stateless, 3 GB cap. Under concurrent load it queues, so watch it.

  Verdict

  - A few users (friends, under ~10): your design as described is fine, once you've fixed points 1
    and 4 and removed pma.
  - A real service: also do 3 and 5. Otherwise RAM per tenant makes it uneconomic, and a shared
    Ollama needs a GPU and a request queue.

  The alternative is real multi-tenancy (a user_id on every table, one backend). That's a big
  refactor and riskier, because one bug leaks data between users. Per-user stacks give stronger
  isolation and are simpler to run with this codebase.