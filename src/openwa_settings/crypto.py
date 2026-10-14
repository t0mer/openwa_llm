import base64
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_NONCE = 12


class SecretBox:
    def __init__(self, key_b64: str) -> None:
        key = base64.b64decode(key_b64)
        if len(key) != 32:
            raise ValueError("SETTINGS_ENCRYPTION_KEY must decode to 32 bytes")
        self._aes = AESGCM(key)

    def encrypt(self, plaintext: str) -> str:
        nonce = os.urandom(_NONCE)
        return base64.b64encode(
            nonce + self._aes.encrypt(nonce, plaintext.encode(), None)
        ).decode()

    def decrypt(self, token: str) -> str:
        raw = base64.b64decode(token)
        try:
            return self._aes.decrypt(raw[:_NONCE], raw[_NONCE:], None).decode()
        except InvalidTag as exc:
            raise ValueError("cannot decrypt secret (wrong key or corrupted)") from exc
