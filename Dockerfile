FROM --platform=$BUILDPLATFORM node:20-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
# vite.config.ts writes to ../src/admin/static/dist  ->  /src/admin/static/dist
RUN npm run build

FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim AS builder
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy

RUN apt-get update -qy
RUN apt-get install -qyy -o APT::Install-Recommends=false -o APT::Install-Suggests=false ca-certificates \
    git wget

WORKDIR /app

RUN --mount=type=secret,id=netrc,target=/root/.netrc,mode=0600 \
    --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=./uv.lock,target=uv.lock \
    --mount=type=bind,source=./pyproject.toml,target=pyproject.toml \
    --mount=type=bind,source=./.python-version,target=.python-version \
    uv sync --frozen --no-dev --no-install-project

COPY . /app
COPY --from=web /src/admin/static/dist /app/src/admin/static/dist

FROM python:3.13-slim-bookworm

COPY --from=builder --chown=app:app /app /app

ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONPATH="/app/src:${PYTHONPATH:-}"

WORKDIR /app

CMD alembic upgrade head && python app/main.py
