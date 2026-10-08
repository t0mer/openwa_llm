# 📱 WhatsApp Group Summary Bot

![release version](https://img.shields.io/github/v/release/ilanbenb/wa_llm)
![Build Image](https://github.com/ilanbenb/wa_llm/actions/workflows/docker.yml/badge.svg)
![Release](https://github.com/ilanbenb/wa_llm/actions/workflows/release.yml/badge.svg)

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
| `docker-compose.prod.yml`      | **Production**. Uses pre-built images from GHCR. Recommended for deployment.   | `docker compose -f docker-compose.prod.yml up -d`      |
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

> Until `OPENWA_SESSION_ID` is set and the web server is restarted (step 4 below), the web server may log errors (webhook registration / status checks). This is expected on the first start.

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

2. **Start Services**:
   ```bash
   docker compose -f docker-compose.prod.yml up -d
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

### Key Files

- Main application: `app/main.py`
- WhatsApp client: `src/whatsapp/client.py`
- Message handler: `src/handler/__init__.py`
- Database models: `src/models/`

---

## Architecture

The project consists of several key components:

- FastAPI backend for webhook handling
- WhatsApp Web API client for message interaction
- PostgreSQL database with vector storage for knowledge base
- AI-powered message processing and response generation

---

## Contributing

1. Fork the repository
2. Create a feature branch
3. Submit a pull request

---

## License

[LICENCE](CODE_OF_CONDUCT.md)
