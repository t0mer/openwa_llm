from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from admin.guards import reject_nul_chars

app = FastAPI()


@app.get("/q", dependencies=[Depends(reject_nul_chars)])
def q(a: str = ""):
    return {"a": a}


@app.get("/p/{x}", dependencies=[Depends(reject_nul_chars)])
def p(x: str):
    return {"x": x}


client = TestClient(app)


def test_clean_input_passes():
    assert client.get("/q?a=hi").status_code == 200
    assert client.get("/p/abc").status_code == 200


def test_nul_in_query_value_key_and_path_is_422():
    assert client.get("/q?a=a%00b").status_code == 422
    assert client.get("/q?a%00=1").status_code == 422
    assert client.get("/p/a%00b").status_code == 422
