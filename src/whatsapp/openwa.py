from __future__ import annotations

import logging
import re
from typing import Any
from urllib.parse import quote

import httpx

from .gateway import GatewayError
from .jid import (
    DefaultUserServer,
    JID,
    parse_jid,
    to_canonical_jid,
    to_openwa_chat_id,
)
from .types import GroupInfo, SessionStatus

logger = logging.getLogger(__name__)


def _unwrap(data: Any) -> Any:
    if isinstance(data, dict) and isinstance(data.get("data"), dict):
        return data["data"]
    return data


def _extract_list(data: Any) -> list[Any]:
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("data", "groups", "items", "results"):
            if isinstance(data.get(key), list):
                return data[key]
    return []


def _first_str(item: dict[str, Any], keys: tuple[str, ...]) -> str | None:
    for key in keys:
        value = item.get(key)
        if isinstance(value, str) and value:
            return value
    return None


def _parse_group(item: Any) -> GroupInfo | None:
    if not isinstance(item, dict):
        return None
    jid = _first_str(item, ("id", "groupId", "jid", "chatId"))
    if not jid:
        return None
    owner = _first_str(item, ("owner", "ownerId", "creator"))
    return GroupInfo(
        jid=to_canonical_jid(jid),
        name=_first_str(item, ("name", "subject")),
        topic=_first_str(item, ("description", "desc", "topic")),
        owner_jid=to_canonical_jid(owner) if owner else None,
    )


class OpenWAGateway:
    """WhatsAppGateway implementation backed by an OpenWA server."""

    def __init__(
        self,
        base_url: str,
        api_key: str,
        session_id: str,
        *,
        groups_page_size: int = 100,
        timeout: float = 30.0,
    ):
        self._session_path = f"/api/sessions/{quote(session_id, safe='')}"
        self._http = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers={"X-API-Key": api_key},
            timeout=timeout,
        )
        self._groups_page_size = groups_page_size
        self._jid: JID | None = None

    async def aclose(self) -> None:
        await self._http.aclose()

    async def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        try:
            resp = await self._http.request(method, path, **kwargs)
        except httpx.HTTPError as e:
            raise GatewayError(f"OpenWA {method} {path} failed: {e}") from e
        if resp.status_code == 409:
            raise GatewayError("OpenWA session is not ready (409)")
        if resp.is_error:
            raise GatewayError(
                f"OpenWA {method} {path} -> {resp.status_code}: {resp.text[:200]}"
            )
        if not resp.content:
            return None
        try:
            return resp.json()
        except ValueError as e:
            raise GatewayError(
                f"OpenWA {method} {path} returned a non-JSON response: "
                f"{resp.text[:200]!r}"
            ) from e

    async def send_text(self, jid: str, text: str, reply_to: str | None = None) -> str:
        body: dict[str, Any] = {"chatId": to_openwa_chat_id(jid), "text": text}
        if reply_to:
            body["quotedMessageId"] = reply_to
        data = _unwrap(
            await self._request(
                "POST", f"{self._session_path}/messages/send-text", json=body
            )
        )
        message_id = data.get("messageId") if isinstance(data, dict) else None
        if not message_id:
            raise GatewayError("OpenWA send-text response had no messageId")
        return str(message_id)

    async def get_status(self) -> SessionStatus:
        data = _unwrap(await self._request("GET", self._session_path))
        if not isinstance(data, dict):
            raise GatewayError("OpenWA session response was not an object")
        phone = data.get("phone")
        return SessionStatus(
            status=str(data.get("status") or "unknown"),
            phone=phone if isinstance(phone, str) and phone else None,
        )

    async def get_my_jid(self) -> JID:
        if self._jid:
            return self._jid
        status = await self.get_status()
        if status.status != "ready" or not status.phone:
            raise GatewayError(f"OpenWA session not ready (status={status.status})")
        digits = re.sub(r"\D", "", status.phone.split("@")[0].split(":")[0])
        if not digits:
            raise GatewayError(f"OpenWA session phone is unusable: {status.phone!r}")
        self._jid = parse_jid(f"{digits}@{DefaultUserServer}")
        return self._jid

    async def list_groups(self) -> list[GroupInfo]:
        groups: list[GroupInfo] = []
        seen: set[str] = set()
        offset = 0
        while True:
            data = await self._request(
                "GET",
                f"{self._session_path}/groups",
                params={"limit": self._groups_page_size, "offset": offset},
            )
            items = _extract_list(data)
            added = 0
            for item in items:
                group = _parse_group(item)
                if group and group.jid not in seen:
                    seen.add(group.jid)
                    groups.append(group)
                    added += 1
            if len(items) < self._groups_page_size or added == 0:
                break
            offset += len(items)
        return groups

    async def ensure_webhook(self, url: str, secret: str, events: list[str]) -> bool:
        """Register a webhook for `url`; refresh secret/events if it exists.

        Returns True only when a new webhook was created.
        """
        existing = _extract_list(
            await self._request("GET", f"{self._session_path}/webhooks")
        )
        wanted = url.rstrip("/")
        body = {"url": url, "events": events, "secret": secret}
        for w in existing:
            if not isinstance(w, dict):
                continue
            registered = w.get("url")
            if not isinstance(registered, str) or registered.rstrip("/") != wanted:
                continue
            webhook_id = w.get("id")
            if webhook_id is None or webhook_id == "":
                logger.warning("OpenWA webhook for %s has no id; cannot update", url)
                return False
            await self._request(
                "PUT",
                f"{self._session_path}/webhooks/{quote(str(webhook_id), safe='')}",
                json=body,
            )
            return False
        await self._request("POST", f"{self._session_path}/webhooks", json=body)
        return True
