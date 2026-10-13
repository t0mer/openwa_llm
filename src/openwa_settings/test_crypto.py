import base64
import os

import pytest

from openwa_settings.crypto import SecretBox


def _key() -> str:
    return base64.b64encode(os.urandom(32)).decode()


def test_round_trip():
    box = SecretBox(_key())
    token = box.encrypt("s3cret")
    assert token != "s3cret"
    assert box.decrypt(token) == "s3cret"


def test_nonce_is_random():
    box = SecretBox(_key())
    assert box.encrypt("x") != box.encrypt("x")


def test_wrong_key_fails():
    token = SecretBox(_key()).encrypt("x")
    with pytest.raises(ValueError):
        SecretBox(_key()).decrypt(token)


def test_tampered_token_fails():
    box = SecretBox(_key())
    raw = bytearray(base64.b64decode(box.encrypt("x")))
    raw[-1] ^= 1
    with pytest.raises(ValueError):
        box.decrypt(base64.b64encode(bytes(raw)).decode())


def test_rejects_short_key():
    with pytest.raises(ValueError):
        SecretBox(base64.b64encode(b"short").decode())
