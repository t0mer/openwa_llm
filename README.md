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
| `docker-compose.yml`           | **Default**. Uses the pre-built `techblog/openwa_llm` image from Docker Hub (`amd64` and `arm64`) and `.env`. | `docker compose up -d`                                 |
| `docker-compose.dev.yml`       | **Development override**. Builds the web server from this checkout and mounts `src/` and `migrations/`. | `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build` |
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

`SETTINGS_ENCRYPTION_KEY` is empty in the example and must be set (generate it as shown in the table below).

#### Environment Variables

<div style="font-size: 10px;">

| Variable                       | Description                                                                        | Default                                                      |
| ------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `SETTINGS_ENCRYPTION_KEY`      | **Required.** Base64 of 32 random bytes; encrypts the OpenWA API key and webhook secret stored in the database. Generate with `python -c "import os,base64;print(base64.b64encode(os.urandom(32)).decode())"`. Back it up with the database (see [Settings and sessions](#settings-and-sessions)) | – |
| `WHATSAPP_HOST`                | *Seed only.* OpenWA base URL (no `/api` suffix), imported on first start           | –                                                            |
| `OPENWA_API_KEY`               | *Seed only* for the app (imported on first start). Compose still passes it to the OpenWA container as its `API_MASTER_KEY` | – |
| `OPENWA_SESSION_ID`            | *Seed only.* `id` of an OpenWA session; becomes the first session on first start   | –                                                            |
| `OPENWA_WEBHOOK_SECRET`        | *Seed only.* HMAC secret for webhook signatures (>= 16 chars)                      | –                                                            |
| `OPENWA_WEBHOOK_URL`           | *Seed only.* Base URL OpenWA posts to; each session registers `<url>/<session id>` | –                                                            |
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
| `TIMEZONE`                     | IANA time zone in which group summary schedules are evaluated (invalid values stop startup) | `Asia/Jerusalem`                    |
| `SCHEDULER_ENABLED`            | Run the in-app scheduler that sends scheduled group summaries; set `false` to disable it | `true`                                  |

</div>

The OpenWA connection (base URL, API key, webhook URL and webhook secret) and the WhatsApp sessions are stored in the database and managed in **Admin > Settings** (see [Settings and sessions](#settings-and-sessions)). The *seed only* variables are read once, on the first start where no connection is stored yet: the connection is imported when `WHATSAPP_HOST`, `OPENWA_API_KEY` and `OPENWA_WEBHOOK_SECRET` are all set, and a session is added when `OPENWA_SESSION_ID` is set. After that, changing them in the env file has no effect on the app. The compose files set `WHATSAPP_HOST` and `OPENWA_WEBHOOK_URL` for you.

### 3. Starting the Services

**Option A: Default (pre-built image from Docker Hub)**

```bash
docker compose up -d
```

The web server image is pulled from Docker Hub on every `up`.

**Development (build from source)**

Build the admin UI on the host first, because the mounted `src/` supplies `src/admin/static/dist`:

```bash
(cd web && npm ci && npm run build)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

**Option B: Production (Use pre-built images)**

`OPENWA_API_KEY` (passed to the OpenWA container as `API_MASTER_KEY`) and `SETTINGS_ENCRYPTION_KEY` (passed to the web server) must be available to compose interpolation; `docker compose` stops with an error if either is missing. Compose reads `.env` for this, not the `env_file:` entries, so if your keys live only in `.env.prod`, pass it explicitly:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d
```

The web server also reads `.env.prod`. The OpenWA API key the app uses comes from **Admin > Settings** (imported from `OPENWA_API_KEY` on the first start only), so if you ever change the OpenWA container's key, enter the new one in Settings too.

### 4. Connect your device

Creating a WhatsApp session and pairing it (QR code) happen in OpenWA; the app only connects to sessions that already exist there. Enable the admin UI first (see [Enabling it](#enabling-it)), because sessions are added in **Admin > Settings**.

1. Start the stack, then create and start a session in OpenWA (use your `OPENWA_API_KEY`):

   ```bash
   curl -s -X POST http://localhost:2785/api/sessions \
     -H "X-API-Key: $OPENWA_API_KEY" -H "Content-Type: application/json" \
     -d '{"name":"wa-llm"}'            # note the returned "id"
   curl -s -X POST http://localhost:2785/api/sessions/<id>/start -H "X-API-Key: $OPENWA_API_KEY"
   ```

2. Get the QR code (`GET /api/sessions/<id>/qr` returns a PNG data URL) or use the dashboard at http://localhost:2785, and scan it with your WhatsApp mobile app. Wait until the session status is `ready`.
3. Open `http://localhost:8000/admin/settings` and check the **Connection** (with compose it was imported on the first start: base URL `http://whatsapp:2785`, webhook URL `http://web-server:8000/webhook`). If it is empty, fill in the base URL, API key, webhook URL and webhook secret and click **Save connection**. Under **Sessions**, add the session with a label of your choice and the OpenWA session `id` from step 1. It becomes active immediately, with no restart: the app syncs its groups and registers its webhook in OpenWA. The session shows its OpenWA status (`ready` once paired), and **Test connection** now checks OpenWA (it needs at least one session).
4. Invite the bot device to any target groups you want to summarize.

Repeat steps 1, 2 and 3 for every further WhatsApp number the bot should serve. If `OPENWA_SESSION_ID` was already set on the very first start, that session was added for you and step 3 is only a check.

#### Upgrading from env-only OpenWA settings

Earlier versions read the OpenWA settings from the env file on every start. They now live in the database:

1. **Add `SETTINGS_ENCRYPTION_KEY`** to your env file before upgrading (the web server does not start without it, and compose stops with an error). Generate it as shown in [Settings and sessions](#settings-and-sessions) and back it up.
2. **Keep the old `OPENWA_*` / `WHATSAPP_HOST` values in place for the first start.** The database migration assigns all existing groups and messages to one session created from `OPENWA_SESSION_ID` (it is called `default`; rename it in Settings). On startup the connection is imported from `WHATSAPP_HOST`, `OPENWA_API_KEY`, `OPENWA_WEBHOOK_SECRET` and `OPENWA_WEBHOOK_URL`. If `OPENWA_SESSION_ID` is not set but data exists, the migration creates a disabled `default` session: set its OpenWA session id in Settings and enable it.
3. **Check Admin > Settings** after the first start. From now on, edit the connection there; later changes to those env vars are ignored (except `OPENWA_API_KEY`, which compose still passes to the OpenWA container as `API_MASTER_KEY`).
4. **Delete the old webhook in OpenWA (optional).** Each session now registers its own URL, `<webhook url>/<session id>`, for example `http://web-server:8000/webhook/<session id>`. A webhook registered earlier at the bare `/webhook` URL keeps being accepted while exactly one session is enabled (with more than one it gets `404`), but OpenWA then delivers every event to both URLs. Both resolve to the same session, and a delivery whose `X-OpenWA-Idempotency-Key` was already processed is skipped, so the duplicate is dropped only if OpenWA sends the same key to both webhooks (not verified). Delete the old registration in OpenWA (its webhooks are listed by `GET /api/sessions/<id>/webhooks`, or use the OpenWA dashboard) so events are not processed twice.

#### Upgrading from the go-whatsapp-web-multidevice (gowa) setup

Earlier versions used [go-whatsapp-web-multidevice](https://github.com/aldinokemal/go-whatsapp-web-multidevice) as the WhatsApp gateway. It has been replaced by OpenWA, so existing deployments need to:

- **Re-pair the bot.** The OpenWA session is new; scan a fresh QR code as described above. Messages, senders, groups and opt-outs in PostgreSQL are unaffected.
- **Update your env file.** Remove `WHATSAPP_BASIC_AUTH_USER` and `WHATSAPP_BASIC_AUTH_PASSWORD`; add `SETTINGS_ENCRYPTION_KEY`, `OPENWA_API_KEY`, `OPENWA_SESSION_ID` and `OPENWA_WEBHOOK_SECRET`; point `WHATSAPP_HOST` at OpenWA (port `2785`, not `3000`). The OpenWA values are imported on the first start, as described in [Upgrading from env-only OpenWA settings](#upgrading-from-env-only-openwa-settings).
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

- **Dashboard**: the start page. Statistics and charts for a date range: groups, chats, messages, active senders, reactions, knowledge-base topics, messages over time, top groups and senders, and activity by hour and weekday (see [Dashboard](#dashboard)).
- **Groups**: turn the bot on/off for a group ("managed"), toggle the spam notice, edit community keys, set a display name and choose the per-group **Summary language**.
  - **Summary language** is `Auto`, `HE`, `EN` or `RU`. `Auto` follows the language of the chat. `HE`, `EN` and `RU` force that language for scheduled and admin-triggered summaries. On-demand summaries (a user asking the bot in the group) follow the language of the request.
- **Contacts**: view and edit sender names.
- **Opt-outs**: view, add and remove opted-out contacts.
- **Schedules**: per-group recurring summaries (see [Scheduled summaries](#scheduled-summaries)).
- **Messages**: read-only message browser with search and filters.
- **Bot actions**: run group summaries or load the knowledge base on demand, for every active session. After a summary run, a per-group result list shows which groups were sent, skipped (for example "9 of 15 messages needed") or failed, and why.
- **Settings**: the OpenWA connection and the WhatsApp sessions the bot serves (see [Settings and sessions](#settings-and-sessions)).
- **Session switcher**: at the top of every page. Dashboard, Groups and Messages show the selected session only; with a single session it just shows its name.

The UI follows the Iris design language: Rubik (bundled with the app, no external font requests), a violet primary colour, soft borders and rounded cards.

- **Theme:** System, Light or Dark. Pick it in the account menu (sidebar footer) or in the **More** sheet on phones. The choice is remembered in the browser; System follows the OS setting live.
- **Navigation:** a sidebar on desktop (Dashboard, Groups, Messages, Bot actions, Contacts, Opt-outs, Settings; labels from 1024px wide, icon-only on tablets from 768px) and, on phones, a header with a bottom tab bar (Dashboard, Groups, Messages, Bot actions) plus a **More** sheet (Contacts, Opt-outs, Settings, theme, log out).
- **Responsive Groups:** a compact table from 1280px, cards below that (two columns from 768px, one column on phones). Contacts, Opt-outs and Messages turn into stacked cards on phones, and dialogs (Edit group, Schedules) become bottom sheets.
- **Confirmations, errors and toasts** use SweetAlert2, themed to match light or dark.
- **Accessibility:** a "Skip to content" link is the first tab stop, everything works from the keyboard, dialogs trap focus and return it to the control that opened them, and group names and JIDs render correctly for right-to-left (Hebrew) text.

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

#### Dashboard

`/admin` opens on the Dashboard: an overview of the activity the bot has stored.

- **Date range:** presets 24 hours, 7 days (the default), 30 days, 90 days and All time, plus **Custom** with From and To dates (days in your browser's local time; the To day is included). The range is kept in the URL (`?range=30d`, `?range=custom&from=2026-08-01&to=2026-08-31`), so reloading or sharing the link keeps it. An invalid or reversed custom range shows an error and is not applied.
- **Auto-refresh:** the relative presets (24 hours to 90 days) reload every 60 seconds while the tab is visible; a refresh missed while the tab was hidden runs when you come back. Custom ranges and All time do not refresh.
- **Tiles:** Groups (all time, with the number of managed groups), Chats (groups and direct chats with at least one message in the range), Messages, Active senders, Reactions and Knowledge-base topics (topics that start in the range).
- **Charts:** Messages over time, Top 5 groups, Top senders (top 10), Activity by hour of day, Activity by weekday and Text vs media (text, media and other messages). Messages over time is grouped per hour, day, week (weeks start on Monday) or month depending on the length of the range. Every chart has a **Show as table** toggle that shows the same numbers as a table.
- **Time zone:** hours, days and weekdays are counted in the server time zone from `TIMEZONE` (default `Asia/Jerusalem`), shown under the range picker.
- **Session:** the numbers cover the session selected in the switcher (its groups and its direct chats). With no active session every number is zero.
- **Bot messages are excluded** from every number (messages and reactions sent by the bot's own WhatsApp account). The bot's identity comes from the live WhatsApp session; if it cannot be looked up, the numbers include the bot and the page says "Bot messages could not be identified and are included".
- A range without messages shows the tiles with zeros and "No messages in this range" instead of the charts.

![Dashboard showing tiles and charts for the last 7 days](assets/screenshots/admin-dashboard-light.png)
![Dashboard for the last 7 days (dark)](assets/screenshots/admin-dashboard-dark.png)

The 30 days preset, grouped per day:

![Dashboard for the last 30 days](assets/screenshots/admin-dashboard-30d-light.png)

A custom range with the From and To dates:

![Dashboard with a custom date range](assets/screenshots/admin-dashboard-custom-light.png)

"Show as table" on the weekday chart, and a range with no messages:

![Activity by weekday shown as a table](assets/screenshots/admin-dashboard-table-light.png)
![Dashboard empty state for a range without messages](assets/screenshots/admin-dashboard-empty-light.png)

On phones the tiles use two columns, the charts stack in one column and the tab bar starts with Dashboard:

<p>
<img src="assets/screenshots/admin-mobile-dashboard-light.png" alt="Dashboard on mobile (light)" width="180">
<img src="assets/screenshots/admin-mobile-dashboard-dark.png" alt="Dashboard on mobile (dark)" width="180">
</p>

The numbers come from `GET /api/v1/admin/stats` (login-protected with the admin session cookie, like the rest of the admin API):

| Parameter | Description |
| --------- | ----------- |
| `from`    | Start of the range, ISO 8601. Optional: defaults to the earliest message (or 7 days before `to` when there are no messages). |
| `to`      | End of the range, ISO 8601, inclusive. Optional: defaults to now. |
| `session_id` | Session id (from `GET /api/v1/admin/settings/sessions`). Optional while only one session is active; required (`400` otherwise) when several are, and `404` for an unknown or inactive session. Groups and Messages take the same parameter. |

Datetimes without an offset are read in `TIMEZONE`. Both must lie between 1970 and 2100, and `from` must not be after `to` (otherwise `422`). Example: `GET /api/v1/admin/stats?from=2026-10-01T00:00:00&to=2026-10-07T23:59:59`.

The response contains:

- `from`, `to` (the resolved range in the configured zone), `timezone` and `bot_excluded` (`false` when the bot could not be identified and its messages are counted).
- Counts in the range: `messages`, `chats` (distinct chats), `active_senders` (distinct senders), `reactions` and `kb_topics`; `groups` is `{total, managed}` and is not limited to the range.
- `split`: `{text, media, other}`. Text is a message with text and no media, media is a message with media, other is the rest.
- `bucket` and `series` (`[{start, count}]`, zero-filled). The bucket is `hour` for ranges up to 48 hours, `day` up to 92 days, `week` up to two years (weeks start on Monday, so the first slot can start before `from`) and `month` beyond that.
- `top_groups` (up to 5) and `top_senders` (up to 10), each `[{…_jid, name, count}]` ordered by count, then JID. A group's `name` is its display name or WhatsApp name, a sender's is the push name; either can be `null` (the UI then shows the number from the JID).
- `by_hour` (24 counts, hour 0 to 23) and `by_weekday` (7 counts, 0 = Sunday to 6 = Saturday).

#### Scheduled summaries

Each group can have its own summary schedules, so summaries no longer need an external cron job. Open **Groups**, click **Schedules** in a group's row (the column also shows how many schedules the group has) and add as many schedules as you like (up to 20 per group):

- A schedule is a set of weekdays plus a time of day, entered in 12-hour form with AM/PM (12 AM is midnight, 12 PM is noon). Each schedule can be enabled or disabled without deleting it, and the dialog shows its last run: when, the outcome (sent, skipped or failed) and the message count.
- Times use the server time zone from `TIMEZONE` (default `Asia/Jerusalem`), shown at the top of the dialog. A time that does not exist on a daylight-saving change runs once at the first valid minute.
- Only groups with **Respond** on (managed) run. A schedule of an unmanaged group is kept but does nothing.
- A run needs at least 15 new messages since the group's last summary. Otherwise it is skipped and recorded as skipped ("Not enough new messages"); the next summary then covers everything since the last one that was actually sent.
- The scheduler checks once a minute. After downtime a missed run is still sent up to 60 minutes late; older missed runs are skipped.
- A run is claimed in the database before it starts, so a restart or a second tick does not repeat it.
- The scheduler runs inside the web server process. Run a single web server process; with `SCHEDULER_ENABLED=false` nothing is scheduled.
- Scheduled runs, admin "Bot actions" and the legacy endpoint share a per-group lock inside one process, so they do not run at the same time for one group.

> **Warning:** if an external cron job still calls `/summarize_and_send_to_groups` and a group also has schedules, that group's summary can be posted twice. Remove the cron job (or the schedules) when you switch.

The API (login-protected, under `/api/v1/admin/groups/{jid}/schedules`):

| Method   | Path                                                 | Purpose                                                            |
| -------- | ---------------------------------------------------- | ------------------------------------------------------------------ |
| `GET`    | `/api/v1/admin/groups/{jid}/schedules`               | List schedules and the configured `timezone`                        |
| `POST`   | `/api/v1/admin/groups/{jid}/schedules`               | Create one (`409` after 20 per group)                              |
| `PATCH`  | `/api/v1/admin/groups/{jid}/schedules/{schedule_id}` | Change weekdays, time or `enabled`                                  |
| `DELETE` | `/api/v1/admin/groups/{jid}/schedules/{schedule_id}` | Delete one                                                         |

Fields: `weekdays` (non-empty list of integers, 0 = Sunday to 6 = Saturday), the time as either `hour` (0-23) or `hour12` (1-12) with `meridiem` (`AM`/`PM`) but not both, `minute` (0-59) and `enabled`. Example: `{"weekdays": [0, 2, 4], "hour12": 9, "minute": 0, "meridiem": "AM"}`.

#### Settings and sessions

**Settings** (`/admin/settings`) holds the OpenWA connection and the WhatsApp sessions the bot serves. One OpenWA server can host several WhatsApp sessions (numbers); the bot serves every enabled one. Changes apply immediately, without restarting the web server.

![Settings page with the OpenWA connection and three sessions](assets/screenshots/admin-settings-light.png)
![Settings page (dark)](assets/screenshots/admin-settings-dark.png)

**Connection** (one for all sessions):

- **OpenWA base URL** (for example `http://whatsapp:2785` inside compose), **API key** (the OpenWA server's `API_MASTER_KEY`), **Webhook URL** and **Webhook secret** (at least 16 characters; OpenWA signs every delivery with it).
- The API key and webhook secret are stored encrypted and are never shown or returned by the API; the form shows "•••• stored" instead. Leave a secret field blank to keep the stored value. Stored secrets are never sent to a different host: when you change the base URL (trailing slashes aside), enter the API key and webhook secret again, otherwise saving fails with `422` (the form says so under the URL).
- The base URL cannot be a literal link-local or cloud metadata address (`169.254.0.0/16`, `fe80::/10`); host names are not resolved for this check.
- The webhook URL is a base URL: each session registers `<webhook url>/<session id>` in OpenWA, for example `http://web-server:8000/webhook/<session id>`. Leave it blank to skip webhook registration (for example when you register webhooks yourself).
- **Save connection** reloads every session and re-registers its webhook. **Test connection** checks OpenWA with the values in the form (blank fields fall back to the stored ones; a changed base URL needs the API key typed again) by reading the status of the first session. It reports `connected`, `OpenWA returned HTTP <status>`, or `cannot reach OpenWA (<error type>)`; OpenWA's own response text is never shown.

**Sessions:**

- Add a session with a **label** (your own name for it) and the **OpenWA session id** (the `id` OpenWA returned when the session was created; each one can be added only once). Creating sessions and pairing them by QR code stay in OpenWA (see [Connect your device](#4-connect-your-device)).
- Each session shows its OpenWA status (for example `ready`), the number of groups it owns, and an error if it could not be started. **Enabled** turns a session on or off without deleting it; a disabled session receives nothing and is not summarized.
- **Re-register webhook** registers (or updates) that session's webhook in OpenWA again, for example after OpenWA lost it.
- **Delete** is refused while the session still owns groups or messages; disable it instead.

**How data is split between sessions:**

- **One WhatsApp group belongs to exactly one session**: the first session that syncs the group owns it. If a second session's number is in the same group, it does not take the group over, and its copies of that group's messages are ignored. Group settings, schedules, summaries and knowledge-base topics follow the group's session. Messages, including direct chats, belong to the session that received them.
- **Contacts and opt-outs are shared**: a sender's name and an opt-out apply in every session.
- The **session switcher** at the top of each admin page picks the session that Dashboard, Groups and Messages show. The choice is remembered in the browser. Disabled sessions cannot be selected; with no enabled session the switcher links to Settings.
- **Bot actions**, the **cron endpoints** (`/summarize_and_send_to_groups`, `/load_new_kbtopics`) and the **scheduler** run for every active session, each with its own OpenWA session; one failing session does not stop the others.

![Session switcher on Groups with the "Family phone" session selected](assets/screenshots/admin-session-switcher-light.png)

**The encryption key.** `SETTINGS_ENCRYPTION_KEY` is required and must be base64 of exactly 32 random bytes (AES-256-GCM). Generate it once:

```bash
python -c "import os,base64;print(base64.b64encode(os.urandom(32)).decode())"
# or: openssl rand -base64 32
```

> **Warning:** back up `SETTINGS_ENCRYPTION_KEY` together with the database. Without the key the stored API key and webhook secret cannot be decrypted, and nothing can recover them: every session then shows a decryption error until you enter the API key and webhook secret again in Settings. Changing the key has the same effect. It is separate from `ADMIN_SESSION_SECRET`, so rotating the login secret never touches the stored credentials.

The settings API (login-protected, under `/api/v1/admin/settings`; like every admin `POST`/`PUT`/`PATCH`/`DELETE`, it also needs the `X-Requested-With: admin-ui` header, otherwise `403`):

| Method   | Path                                            | Purpose |
| -------- | ----------------------------------------------- | ------- |
| `GET`    | `/api/v1/admin/settings/connection`             | The connection: `base_url`, `webhook_url`, `api_key_set`, `webhook_secret_set` (secrets are never returned) |
| `PUT`    | `/api/v1/admin/settings/connection`             | Save `base_url`, `webhook_url`, `api_key`, `webhook_secret`. A missing or `null` secret keeps the stored one (both are required the first time, and again whenever `base_url` changes: `422` otherwise). A link-local `base_url` is `422`. Reloads all sessions and re-registers their webhooks |
| `POST`   | `/api/v1/admin/settings/connection/test`        | Check OpenWA with optional `base_url`, `api_key` and `openwa_session_id` (fallback: the stored values and the first session; a `base_url` different from the stored one needs `api_key`, else `422`). Returns `{ok, detail}`, where `detail` is `connected`, `OpenWA returned HTTP <status>` or `cannot reach OpenWA (<error type>)` |
| `GET`    | `/api/v1/admin/settings/sessions`               | List sessions: `id`, `label`, `openwa_session_id`, `enabled`, `status`, `error`, `group_count` (the status is refreshed live, 3 seconds at most) |
| `POST`   | `/api/v1/admin/settings/sessions`               | Add a session: `{label, openwa_session_id}` (`409` if that OpenWA session id is already used) |
| `PATCH`  | `/api/v1/admin/settings/sessions/{session_id}`  | Change `label`, `openwa_session_id` or `enabled` |
| `DELETE` | `/api/v1/admin/settings/sessions/{session_id}`  | Delete a session (`409` while it still owns groups or messages) |
| `POST`   | `/api/v1/admin/settings/sessions/{session_id}/webhook` | Re-register the session's webhook (`409` if the session is not active or no webhook URL is set, `502` with the HTTP status or error type if OpenWA refused) |

`{session_id}` is the app's own session id (the `id` field), not the OpenWA session id. The same id is used by the `session_id` query parameter of the other admin endpoints and the cron endpoints, and in the webhook URL.

#### Notes

- **Group names:** the WhatsApp name, topic and owner are refreshed from WhatsApp and are read-only. The "display name" is your own alias and survives syncs.
- **Enabling a long-disabled group:** the next summary covers everything since the group's last summary date (the UI warns before enabling).
- **Bot actions** run the same jobs as the cron endpoints, in the background, one at a time per action. Their status is kept in memory and resets on restart.
- **Cron endpoints are unauthenticated.** `POST /summarize_and_send_to_groups` and `POST /load_new_kbtopics` are still open because the scheduled scripts use them. Without parameters they run for every active session; `?session_id=<session id>` limits them to one (`404` if it is unknown or inactive). One failing session does not stop the others: the response has a `sessions` map of session id to `ok` or `failed`, and the call returns `500` only when every session failed. Running a job from the UI at the same time as the cron job can post a summary twice. Keep those endpoints off the public internet.

#### Screenshots

#### Login
![Login](assets/screenshots/admin-login-light.png)
![Login (dark)](assets/screenshots/admin-login-dark.png)

#### Groups
![Groups](assets/screenshots/admin-groups-light.png)
![Groups (dark)](assets/screenshots/admin-groups-dark.png)

At about 900px the sidebar collapses to icons and Groups shows cards:

![Groups with the icon-only sidebar](assets/screenshots/admin-sidebar-collapsed-light.png)

The account menu holds the theme switch (System / Light / Dark) and log out:

![Account menu](assets/screenshots/admin-account-menu-light.png)

Between 768px and 1279px Groups shows cards; the full sidebar appears from 1024px:

![Groups on a 1024px tablet](assets/screenshots/admin-groups-tablet-light.png)

Toasts (SweetAlert2) appear in the top-right corner, here after **Re-register webhook** in Settings:

![Toast](assets/screenshots/admin-toast-light.png)

#### Schedules
The Schedules dialog of a group, in light and dark:

![Schedules dialog](assets/screenshots/admin-schedules-light.png)
![Schedules dialog (dark)](assets/screenshots/admin-schedules-dark.png)

Editing a group (display name, summary language and community keys):

![Edit group](assets/screenshots/admin-groups-edit-light.png)
![Edit group (dark)](assets/screenshots/admin-groups-edit-dark.png)

Enabling the bot asks for confirmation (SweetAlert2):

![Enable bot confirmation](assets/screenshots/admin-groups-confirm-light.png)
![Enable bot confirmation (dark)](assets/screenshots/admin-groups-confirm-dark.png)

#### Contacts
![Contacts](assets/screenshots/admin-contacts-light.png)
![Contacts (dark)](assets/screenshots/admin-contacts-dark.png)

#### Opt-outs
![Opt-outs](assets/screenshots/admin-opt-outs-light.png)
![Opt-outs (dark)](assets/screenshots/admin-opt-outs-dark.png)

#### Messages
![Messages](assets/screenshots/admin-messages-light.png)
![Messages (dark)](assets/screenshots/admin-messages-dark.png)

#### Settings
The OpenWA connection and the sessions (more in [Settings and sessions](#settings-and-sessions)):

![Settings](assets/screenshots/admin-settings-light.png)
![Settings (dark)](assets/screenshots/admin-settings-dark.png)

The session switcher above every page, here with the "Family phone" session selected:

![Session switcher](assets/screenshots/admin-session-switcher-light.png)

#### Bot actions
![Bot actions](assets/screenshots/admin-actions-light.png)
![Bot actions (dark)](assets/screenshots/admin-actions-dark.png)

Summary results per group after a run:

![Summary results](assets/screenshots/admin-actions-results-light.png)
![Summary results (dark)](assets/screenshots/admin-actions-results-dark.png)

#### Mobile
<p>
<img src="assets/screenshots/admin-mobile-groups-light.png" alt="Groups on mobile (light)" width="180">
<img src="assets/screenshots/admin-mobile-groups-dark.png" alt="Groups on mobile (dark)" width="180">
<img src="assets/screenshots/admin-mobile-messages-light.png" alt="Messages on mobile (light)" width="180">
<img src="assets/screenshots/admin-mobile-messages-dark.png" alt="Messages on mobile (dark)" width="180">
<img src="assets/screenshots/admin-mobile-actions-light.png" alt="Bot actions on mobile (light)" width="180">
<img src="assets/screenshots/admin-mobile-actions-dark.png" alt="Bot actions on mobile (dark)" width="180">
<img src="assets/screenshots/admin-mobile-schedules-light.png" alt="Schedules dialog on mobile (light)" width="180">
<img src="assets/screenshots/admin-mobile-schedules-dark.png" alt="Schedules dialog on mobile (dark)" width="180">
<img src="assets/screenshots/admin-mobile-more-light.png" alt="More sheet on mobile (light)" width="180">
<img src="assets/screenshots/admin-mobile-more-dark.png" alt="More sheet on mobile (dark)" width="180">
</p>

### 6. API usage

Swagger docs available at: `http://localhost:8000/docs`

#### Key Endpoints

- <b>/load_new_kbtopics (POST)</b> Loads new knowledge base topics from the managed groups' conversations. Runs for every active session, or one with `?session_id=` (see [Notes](#notes)).
- <b>/summarize_and_send_to_groups (POST)</b> Generates summaries and sends them to all managed groups. Runs for every active session, or one with `?session_id=`.
- <b>/api/v1/admin/stats (GET)</b> Dashboard statistics for a date range, bot messages excluded (admin login required; see [Dashboard](#dashboard)).
- <b>/api/v1/admin/settings/…</b> OpenWA connection and sessions (admin login required; see [Settings and sessions](#settings-and-sessions)).

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

The admin UI is a React 19 + Vite SPA in `web/` (Node 20) styled with Tailwind CSS 4, Radix UI primitives, lucide icons and SweetAlert2. Design tokens (colours, radii, fonts) for light and dark live in `web/src/index.css`:

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
- Stored OpenWA settings (encryption, one-time env import, per-session gateway registry): `src/openwa_settings/`; settings API: `src/admin/settings.py`
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

OpenWA delivers incoming messages, reactions and group events to `POST /webhook/{session id}`, one URL per session (the session id is the app's own id shown by `GET /api/v1/admin/settings/sessions`):

- **Signed requests.** Every request must carry `X-OpenWA-Signature: sha256=<hex>`, the HMAC-SHA256 of the raw body using the webhook secret from **Admin > Settings > Connection**. The signature is verified before the body is parsed or the session is looked up; a missing or invalid signature (or no stored secret) returns `401`, malformed JSON returns `400`, and bodies larger than 2 MiB return `413`. A signed delivery for an unknown or disabled session is acknowledged and ignored.
- **Registration.** If the connection has a webhook URL, the web server registers (or updates) `<webhook url>/<session id>` with OpenWA for every active session, for `message.received`, `message.reaction` and the `group.*` events: at startup (retrying for a few minutes while OpenWA starts), when a session is added or enabled, when the connection is saved, and on **Re-register webhook**. OpenWA's SSRF guard must allow that host; the compose files set `SSRF_ALLOWED_HOSTS` for you.
- **Legacy URL.** The bare `POST /webhook` used by earlier versions still works while exactly one session is enabled. It needs the same signature (checked first, so an unsigned request gets `401` whatever the number of sessions); a signed request returns `404` when zero or several sessions are enabled. See [Upgrading from env-only OpenWA settings](#upgrading-from-env-only-openwa-settings).
- **Redelivery.** OpenWA delivers at least once. Deliveries are deduplicated per session on `X-OpenWA-Idempotency-Key`; a delivery whose processing failed is not marked as seen, so OpenWA's retry is processed again.
- **Identities.** Users are stored as `<number>@s.whatsapp.net`; the adapter converts OpenWA's `@c.us` ids in both directions. Senders that OpenWA reports as `@lid` are mapped to their phone number when `RESOLVE_LID_TO_PHONE=true` (set in the compose files) provides `senderPhone`.
- **Tagging the bot (`@lid`).** WhatsApp may tag the bot, and identify senders, by a privacy id (`<digits>@lid`) instead of the phone number. At runtime the app learns the bot's own `@lid` from OpenWA (`GET /api/sessions/<id>/contacts/check/<phone>`, field `whatsappId`) and caches it. A tag by phone number or by `@lid` counts as a mention, and the bot's own messages are ignored under either id (summaries and the knowledge base also exclude both). If the lookup fails (OpenWA error, session not ready, unexpected response), the bot falls back to phone-number mentions only and does not retry for 300 seconds. Check `bot_lid` in `/status` (add `?session_id=<session id>` when more than one session is active): it is the learned id, or `null` when unknown. For an OpenWA server you run yourself, set `RESOLVE_LID_TO_PHONE=true` so senders also resolve to phone numbers.

---

## Contributing

1. Fork the repository
2. Create a feature branch
3. Submit a pull request

---

## License

[LICENCE](CODE_OF_CONDUCT.md)
