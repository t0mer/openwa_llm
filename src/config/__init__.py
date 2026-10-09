from os import environ
from typing import Self

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from whatsapp.jid import (
    parse_jid,
    JIDParseError,
    DefaultUserServer,
    LegacyUserServer,
    GroupServer,
    to_canonical_jid,
)


class Settings(BaseSettings):
    # API settings
    port: int = 5001
    host: str = "0.0.0.0"

    # Database settings
    db_uri: str

    # WhatsApp (OpenWA) settings
    whatsapp_host: str
    openwa_api_key: str
    openwa_session_id: str
    openwa_webhook_secret: str  # >= 16 chars (OpenWA requirement)
    openwa_webhook_url: str = ""  # if set, registered with OpenWA at startup

    anthropic_api_key: str

    # Voyage settings
    voyage_api_key: str
    voyage_max_retries: int = 5

    # Model settings
    model_name: str = "anthropic:claude-sonnet-4-6"

    # Direct Message settings
    dm_autoreply_enabled: bool = False
    dm_autoreply_message: str = (
        "Hello, I am not designed to answer to personal messages."
    )

    # QA tester settings (user JIDs allowed to use /kb_qa command)
    qa_testers: list[str] = []

    # QA test groups (group JIDs where /kb_qa command is allowed)
    qa_test_groups: list[str] = []

    # Optional settings
    debug: bool = False
    log_level: str = "INFO"
    logfire_token: str

    # Admin UI (disabled unless both password and session secret are set)
    admin_password: str | None = None
    admin_session_secret: str | None = None  # >= 32 chars
    admin_cookie_secure: bool = False

    # Scheduled summaries
    timezone: str = "Asia/Jerusalem"  # IANA zone schedules are evaluated in
    scheduler_enabled: bool = True

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, v: str) -> str:
        try:
            ZoneInfo(v)
        except (ZoneInfoNotFoundError, ValueError, OSError) as e:
            raise ValueError(
                f"Invalid TIMEZONE '{v}': expected an IANA name such as "
                "'Asia/Jerusalem' or 'UTC'"
            ) from e
        return v

    @field_validator("qa_testers")
    @classmethod
    def validate_qa_testers(cls, v: list[str]) -> list[str]:
        """Validate that qa_testers contains valid user JIDs."""
        valid_user_servers = (DefaultUserServer, LegacyUserServer)
        for jid_str in v:
            try:
                jid = parse_jid(jid_str)
            except JIDParseError as e:
                raise ValueError(f"Invalid JID '{jid_str}': {e}") from e

            if jid.server not in valid_user_servers:
                raise ValueError(
                    f"Invalid user JID '{jid_str}'. Expected server to be one of "
                    f"{valid_user_servers}, got '{jid.server}'"
                )
            if not jid.user:
                raise ValueError(f"Invalid user JID '{jid_str}'. Missing user part.")
        return [to_canonical_jid(jid_str) for jid_str in v]

    @field_validator("qa_test_groups")
    @classmethod
    def validate_qa_test_groups(cls, v: list[str]) -> list[str]:
        """Validate that qa_test_groups contains valid group JIDs."""
        for jid_str in v:
            try:
                jid = parse_jid(jid_str)
            except JIDParseError as e:
                raise ValueError(f"Invalid JID '{jid_str}': {e}") from e

            if not jid.is_group():
                raise ValueError(
                    f"Invalid group JID '{jid_str}'. Expected server '{GroupServer}', "
                    f"got '{jid.server}'"
                )
            if not jid.user:
                raise ValueError(
                    f"Invalid group JID '{jid_str}'. Missing group ID part."
                )
        return v

    @field_validator("openwa_webhook_secret")
    @classmethod
    def validate_webhook_secret(cls, v: str) -> str:
        if len(v) < 16:
            raise ValueError("openwa_webhook_secret must be at least 16 characters")
        return v

    @field_validator("admin_session_secret")
    @classmethod
    def validate_admin_session_secret(cls, v: str | None) -> str | None:
        if v and len(v) < 32:
            raise ValueError("admin_session_secret must be at least 32 characters")
        return v or None

    @field_validator("admin_password")
    @classmethod
    def blank_admin_password_is_unset(cls, v: str | None) -> str | None:
        return v or None

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        arbitrary_types_allowed=True,
        case_sensitive=False,
        extra="ignore",
    )

    @model_validator(mode="after")
    def apply_env(self) -> Self:
        if self.anthropic_api_key:
            environ["ANTHROPIC_API_KEY"] = self.anthropic_api_key

        if self.logfire_token:
            environ["LOGFIRE_TOKEN"] = self.logfire_token

        return self


@lru_cache
def get_settings() -> Settings:
    # Use model_validate({}) to trigger Pydantic's validation and environment variable loading
    # without passing arguments directly, which satisfies type checkers that would otherwise
    # complain about missing required fields in __init__.
    return Settings.model_validate({})
