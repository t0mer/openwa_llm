# 📱 WhatsApp Group Summary Bot

![release version](https://img.shields.io/github/v/release/t0mer/openwa_llm)
![Build Image](https://github.com/t0mer/openwa_llm/actions/workflows/docker.yml/badge.svg)
![Release](https://github.com/t0mer/openwa_llm/actions/workflows/release.yml/badge.svg)

AI-powered WhatsApp bot that **joins any group, tracks conversations, and generates intelligent summaries**.

---

## Features

- 🤖 Automated group chat responses (when mentioned)
- 📝 Smart **LLM-based conversation summaries**
- 📚 Knowledge base integration for context-aware answers
- 📂 Persistent message history with PostgreSQL + `pgvector`
- 🔗 Support for multiple message types (text, media, links)
- 👥 Group management & customizable settings
- 🔕 **Opt-out feature**: Users can opt-out of being tagged in summaries/answers via DM.
- ⚡ REST API with Swagger docs (`localhost:8000/docs`)

---

## 🐳 Docker Compose Configurations

This project includes multiple Docker Compose files for different environments:

| File                           | Purpose                                                                        | Usage                                                  |
| ------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------ |
| `docker-compose.yml`           | **Default/Development**. Builds the application from source code.              | `docker compose up -d`                                 |
| `docker-compose.prod.yml`      | **Production**. Uses the pre-built `techblog/openwa_llm` image from Docker Hub. Recommended for deployment.   | `docker compose -f docker-compose.prod.yml up -d`      |
| `docker-compose.local-run.yml` | **Local Execution**. For running the app on host while services run in Docker. | `docker compose -f docker-compose.local-run.yml up -d` |
| `docker-compose.base.yml`      | **Base Configuration**. Contains shared service definitions.                   | ❌ **Do not use directly**                             |

---

## 📋 Prerequisites

- 🐳 Docker and Docker Compose
- 🐍 Python 3.13+
- 🗄️ PostgreSQL with `pgvector` extension
- 🔑 Voyage AI API key
- 📲 WhatsApp account for the bot

## Quick Start

### 1. Clone & Configure

`git clone https://github.com/YOUR_USER/wa_llm.git
cd wa_llm`

### 2. Create .env file

- Copy `.env.example` to `.env` and fill in required values.

```
cp .env.example .env
```

#### Environment Variables

<div style="font-size: 10px;">

| Variable                       | Description                                                                        | Default                                                      |
| ------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `WHATSAPP_HOST`                | OpenWA base URL (no `/api` suffix)                                                 | `http://localhost:2785`                                      |
| `OPENWA_API_KEY`               | OpenWA API key (also passed to the OpenWA container as `API_MASTER_KEY`)           | –                                                            |
| `OPENWA_SESSION_ID`            | `id` of the OpenWA session the bot uses                                            | –                                                            |
| `OPENWA_WEBHOOK_SECRET`        | HMAC secret for webhook signatures (>= 16 chars)                                   | –                                                            |
| `OPENWA_WEBHOOK_URL`           | URL OpenWA should post to; registered automatically at startup if set              | –                                                            |
| `VOYAGE_API_KEY`               | Voyage AI key                                                                      | –                                                            |
| `DB_URI`                       | PostgreSQL URI                                                                     | `postgresql+asyncpg://user:password@localhost:5432/postgres` |
| `LOG_LEVEL`                    | Log level (`DEBUG`, `INFO`, `ERROR`)                                               | `INFO`                                                       |
| `ANTHROPIC_API_KEY`            | Anthropic API key. You need to have a real anthropic key here, starts with sk-.... | –                                                            |
| `LOGFIRE_TOKEN`                | Logfire monitoring key, You need to have a real logfire key here                   | –                                                            |
| `DM_AUTOREPLY_ENABLED`         | Enable auto-reply for direct messages                                              | `False`                                                      |
| `DM_AUTOREPLY_MESSAGE`         | Message to send as auto-reply                                                      | `Hello, I am not designed to answer to personal messages.`   |
| `ADMIN_PASSWORD`               | Admin UI login password. The admin UI is disabled unless both this and `ADMIN_SESSION_SECRET` are set | –                                          |
| `ADMIN_SESSION_SECRET`         | Secret (>= 32 random chars) that signs the admin session cookie; generate with `openssl rand -hex 32`. Changing it logs everyone out | – |
| `ADMIN_COOKIE_SECURE`          | Mark the admin session cookie `Secure`; set to `true` when served over HTTPS       | `false`                                                      |

</div>

### 3. Starting the Services

**Option A: Development (Build from source)**

```bash
docker compose up -d
```

**Option B: Production (Use pre-built images)**

`OPENWA_API_KEY` must be available to compose interpolation (it is passed to the OpenWA container as `API_MASTER_KEY`). Compose reads `.env` for this, not the `env_file:` entries, so if your keys live only in `.env.prod`, pass it explicitly:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d
```

The web-server also reads `.env.prod`, so `OPENWA_API_KEY` must have the same value there.

### 4. Connect your device

> Until `OPENWA_SESSION_ID` is set and the web server is restarted (the last step of this section), the web server may log errors (webhook registration / status checks). This is expected on the first start.

1. Start the stack, then create and start a session (use your `OPENWA_API_KEY`):

   ```bash
   curl -s -X POST http://localhost:2785/api/sessions \
     -H "X-API-Key: $OPENWA_API_KEY" -H "Content-Type: application/json" \
     -d '{"name":"wa-llm"}'            # copy the returned "id" into OPENWA_SESSION_ID
   curl -s -X POST http://localhost:2785/api/sessions/<id>/start -H "X-API-Key: $OPENWA_API_KEY"
   ```

2. Get the QR code (`GET /api/sessions/<id>/qr` returns a PNG data URL) or use the dashboard at http://localhost:2785, and scan it with your WhatsApp mobile app. Wait until the session status is `ready`.
3. Invite the bot device to any target groups you want to summarize.
4. Restart the web server so it picks up the session id: `docker compose restart web-server`

#### Upgrading from the go-whatsapp-web-multidevice (gowa) setup

Earlier versions used [go-whatsapp-web-multidevice](https://github.com/aldinokemal/go-whatsapp-web-multidevice) as the WhatsApp gateway. It has been replaced by OpenWA, so existing deployments need to:

- **Re-pair the bot.** The OpenWA session is new; scan a fresh QR code as described above. Messages, senders, groups and opt-outs in PostgreSQL are unaffected.
- **Update your env file.** Remove `WHATSAPP_BASIC_AUTH_USER` and `WHATSAPP_BASIC_AUTH_PASSWORD`; add `OPENWA_API_KEY`, `OPENWA_SESSION_ID` and `OPENWA_WEBHOOK_SECRET`; point `WHATSAPP_HOST` at OpenWA (port `2785`, not `3000`).
- **Expect a new volume.** OpenWA stores its data in `wa_llm_openwa`. The old `wa_llm_whatsapp` volume is no longer used and can be removed once you no longer need it.
- **Review `QA_TESTERS`.** Entries ending in `@c.us` are accepted and converted to `@s.whatsapp.net`, which is how users are stored in the database.

### 5. Activating the Bot for a Group

1. open pgAdmin or any other posgreSQL admin tool
2. connect using
   | Parameter | Value |
   | --------- | --------- |
   | Host | localhost |
   | Port | 5432 |
   | Database | postgres |
   | Username | user |
   | Password | password |

3. run the following update statement:

   ```
       UPDATE public."group"
       SET managed = true
       WHERE group_name = 'Your Group Name';
   ```

4. Restart the service: `docker compose restart wa_llm-web-server`

### Admin UI

A web admin UI (served at `/admin`) lets you manage the bot without touching the database:

- **Groups**: turn the bot on/off for a group ("managed"), toggle the spam notice, edit community keys and set a display name.
- **Contacts**: view and edit sender names.
- **Opt-outs**: view, add and remove opted-out contacts.
- **Messages**: read-only message browser with search and filters.
- **Bot actions**: run group summaries or load the knowledge base on demand.

#### Enabling it

The admin UI is **off by default**. Set both `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET` (they are intentionally not set in `.env.example`), restart the web server and open `http://localhost:8000/admin`:

```bash
ADMIN_PASSWORD=choose-a-strong-password
ADMIN_SESSION_SECRET=$(openssl rand -hex 32)
```

- Sessions last 12 hours. Logging out only clears the browser cookie: sessions are stateless, so change `ADMIN_SESSION_SECRET` to revoke all of them.
- Login attempts are rate-limited to 5 failures per minute per client IP. The limiter keys on the connecting address, so behind a reverse proxy configure the proxy / uvicorn forwarded-headers handling so clients are not all seen as one address.
- HTTPS is strongly recommended: terminate TLS at a reverse proxy and set `ADMIN_COOKIE_SECURE=true`.
- The admin API lives under `/api/v1/admin` (login-protected; see Swagger at `/docs`).

#### Notes

- **Group names:** the WhatsApp name, topic and owner are refreshed from WhatsApp and are read-only. The "display name" is your own alias and survives syncs.
- **Enabling a long-disabled group:** the next summary covers everything since the group's last summary date (the UI warns before enabling).
- **Bot actions** run the same jobs as the cron endpoints, in the background, one at a time per action. Their status is kept in memory and resets on restart.
- **Cron endpoints are unchanged and unauthenticated.** `/summarize_and_send_to_groups` and `/load_new_kbtopics` are still open because the scheduled scripts use them. Running a job from the UI at the same time as the cron job can post a summary twice. Keep those endpoints off the public internet.

#### Screenshots

#### Login
![Login](assets/screenshots/admin-login-light.png)
![Login (dark)](assets/screenshots/admin-login-dark.png)

#### Groups
![Groups](assets/screenshots/admin-groups-light.png)
![Groups (dark)](assets/screenshots/admin-groups-dark.png)

Editing a group (display name and community keys):

![Edit group](assets/screenshots/admin-groups-edit-light.png)

#### Contacts
![Contacts](assets/screenshots/admin-contacts-light.png)
![Contacts (dark)](assets/screenshots/admin-contacts-dark.png)

#### Opt-outs
![Opt-outs](assets/screenshots/admin-opt-outs-light.png)
![Opt-outs (dark)](assets/screenshots/admin-opt-outs-dark.png)

#### Messages
![Messages](assets/screenshots/admin-messages-light.png)
![Messages (dark)](assets/screenshots/admin-messages-dark.png)

#### Bot actions
![Bot actions](assets/screenshots/admin-actions-light.png)
![Bot actions (dark)](assets/screenshots/admin-actions-dark.png)

### 6. API usage

Swagger docs available at: `http://localhost:8000/docs`

#### Key Endpoints

- <b>/load_new_kbtopic (POST)</b> Loads a new knowledge base topic, prepares content for summarization.
- <b>/trigger_summarize_and_send_to_groups (POST)</b> Generates & dispatches summaries, Sends summaries to all managed groups

### 7. Opt-Out Feature

Users can control whether they are tagged in bot-generated messages (summaries, answers) by sending Direct Messages (DMs) to the bot:

| Command   | Description                                                                        |
| :-------- | :--------------------------------------------------------------------------------- |
| `opt-out` | Opt-out of being tagged. Your name will be displayed as text instead of a mention. |
| `opt-in`  | Opt-in to being tagged (default).                                                  |
| `status`  | Check your current opt-out status.                                                 |

> **Note:** This only affects messages generated by the bot. It does not prevent other users from tagging you manually.

---

## 🚀 Production Deployment

To deploy in a production environment using the optimized configuration:

1. **Create Production Environment File**:
   Copy `.env.example` to `.env.prod` and configure your production secrets.

   ```bash
   cp .env.example .env.prod
   ```

2. **Start Services** (`--env-file` lets compose read `OPENWA_API_KEY` from `.env.prod`, see [Starting the Services](#3-starting-the-services)):
   ```bash
   docker compose --env-file .env.prod -f docker-compose.prod.yml up -d
   ```

This configuration includes:

- Automatic restart policies (`restart: always`)

---

## Developing

### Setup

Install dependencies using `uv`:

```bash
uv sync --all-extras --dev
```

### Development Commands

The project uses **Poe the Poet** for task automation with parallel execution:

```bash
# Run all checks (format, then parallel lint/typecheck/test)
uv run poe check

# Individual tasks
uv run poe format     # Format code with ruff
uv run poe lint       # Lint code with ruff
uv run poe typecheck  # Type check with pyright
uv run poe test       # Run tests with pytest

# List all available tasks
uv run poe
```

The `check` command runs formatting first, then executes linting, type checking, and testing **in parallel** for faster execution.

### Frontend (admin UI)

The admin UI is a React + Vite SPA in `web/` (Node 20):

```bash
cd web
npm ci
npm run dev    # dev server; proxies /api to localhost:8000, open http://localhost:5173/admin/
npm run lint   # type check
npm test       # unit tests
npm run build  # writes to src/admin/static/dist, served by the backend
```

The Docker build compiles the SPA in a Node stage, so no local build is needed for images.

Admin integration tests need a Postgres database whose name contains `test`:

```bash
ADMIN_TEST_DB_URI=postgresql+asyncpg://user:password@localhost:5432/<db with "test" in its name> uv run pytest
```

> **Warning:** that database's tables are dropped and recreated.

### Key Files

- Main application: `app/main.py`
- WhatsApp gateway interface and types: `src/whatsapp/gateway.py`, `src/whatsapp/types.py`
- OpenWA client and webhook parser: `src/whatsapp/openwa.py`, `src/whatsapp/openwa_webhook.py`
- Webhook endpoint: `src/api/webhook.py`
- Message handler: `src/handler/__init__.py`
- Database models: `src/models/`
- Admin backend (auth, API, SPA serving): `src/admin/`
- Admin frontend (React SPA): `web/`

---

## Architecture

The project consists of several key components:

- FastAPI backend for webhook handling
- [OpenWA](https://github.com/rmyndharis/OpenWA) (engine `whatsapp-web.js`) as the WhatsApp gateway, accessed through a gateway-neutral `WhatsAppGateway` interface
- PostgreSQL database with vector storage for knowledge base
- AI-powered message processing and response generation

### Webhooks

OpenWA delivers incoming messages, reactions and group events to `POST /webhook`:

- **Signed requests.** Every request must carry `X-OpenWA-Signature: sha256=<hex>`, the HMAC-SHA256 of the raw body using `OPENWA_WEBHOOK_SECRET`. The signature is verified before the body is parsed; a missing or invalid signature (or an unset secret) returns `401`, malformed JSON returns `400`, and bodies larger than 2 MiB return `413`.
- **Registration.** If `OPENWA_WEBHOOK_URL` is set, the web server registers (or updates) the webhook with OpenWA at startup for `message.received`, `message.reaction` and the `group.*` events, retrying for a few minutes while OpenWA starts. OpenWA's SSRF guard must allow that host; the compose files set `SSRF_ALLOWED_HOSTS` for you.
- **Redelivery.** OpenWA delivers at least once. Deliveries are deduplicated on `X-OpenWA-Idempotency-Key`; a delivery whose processing failed is not marked as seen, so OpenWA's retry is processed again.
- **Identities.** Users are stored as `<number>@s.whatsapp.net`; the adapter converts OpenWA's `@c.us` ids in both directions. Senders that OpenWA reports as `@lid` are mapped to their phone number when `RESOLVE_LID_TO_PHONE=true` (set in the compose files) provides `senderPhone`.
- **Tagging the bot (`@lid`).** WhatsApp may tag the bot, and identify senders, by a privacy id (`<digits>@lid`) instead of the phone number. At runtime the app learns the bot's own `@lid` from OpenWA (`GET /api/sessions/<id>/contacts/check/<phone>`, field `whatsappId`) and caches it. A tag by phone number or by `@lid` counts as a mention, and the bot's own messages are ignored under either id (summaries and the knowledge base also exclude both). If the lookup fails (OpenWA error, session not ready, unexpected response), the bot falls back to phone-number mentions only and does not retry for 300 seconds. Check `bot_lid` in `/status`: it is the learned id, or `null` when unknown. For an OpenWA server you run yourself, set `RESOLVE_LID_TO_PHONE=true` so senders also resolve to phone numbers.

---

## Contributing

1. Fork the repository
2. Create a feature branch
3. Submit a pull request

---

## License

[LICENCE](CODE_OF_CONDUCT.md)
