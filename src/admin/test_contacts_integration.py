from models import OptOut, Sender


async def test_contacts_list_opt_out_flag_search_and_edit(
    admin_client, db_sessionmaker
):
    async with db_sessionmaker() as session:
        session.add(Sender(jid="1@s.whatsapp.net", push_name="Dana"))
        session.add(Sender(jid="2@s.whatsapp.net", push_name=None))
        session.add(OptOut(jid="1@s.whatsapp.net"))
        await session.commit()
    body = (await admin_client.get("/api/v1/admin/contacts")).json()
    assert body["total"] == 2
    flags = {c["jid"]: c["opted_out"] for c in body["items"]}
    assert flags == {"1@s.whatsapp.net": True, "2@s.whatsapp.net": False}
    only = (await admin_client.get("/api/v1/admin/contacts?opted_out=false")).json()
    assert [c["jid"] for c in only["items"]] == ["2@s.whatsapp.net"] and only[
        "total"
    ] == 1
    assert (
        await admin_client.get("/api/v1/admin/contacts", params={"search": "dan"})
    ).json()["total"] == 1
    resp = await admin_client.patch(
        "/api/v1/admin/contacts/2@s.whatsapp.net", json={"push_name": "Eli"}
    )
    assert resp.json()["push_name"] == "Eli" and resp.json()["opted_out"] is False
    opted = await admin_client.patch(
        "/api/v1/admin/contacts/1@s.whatsapp.net", json={"push_name": "Dani"}
    )
    assert opted.json()["push_name"] == "Dani" and opted.json()["opted_out"] is True


async def test_opt_out_roundtrip(admin_client, db_sessionmaker):
    r1 = await admin_client.post(
        "/api/v1/admin/opt-outs", json={"jid": "+972 50-123-4567"}
    )
    assert r1.status_code == 201
    r2 = await admin_client.post(
        "/api/v1/admin/opt-outs", json={"jid": "972501234567@c.us"}
    )
    assert r2.status_code == 200
    listed = (await admin_client.get("/api/v1/admin/opt-outs")).json()
    assert [o["jid"] for o in listed] == ["972501234567@s.whatsapp.net"]
    assert (
        await admin_client.delete("/api/v1/admin/opt-outs/972501234567@s.whatsapp.net")
    ).status_code == 204
    assert (
        await admin_client.delete("/api/v1/admin/opt-outs/972501234567@s.whatsapp.net")
    ).status_code == 204
    assert (await admin_client.get("/api/v1/admin/opt-outs")).json() == []
    assert (
        await admin_client.post("/api/v1/admin/opt-outs", json={"jid": "1203@g.us"})
    ).status_code == 422


async def test_huge_offset_is_422_not_500(admin_client):
    huge = "99999999999999999999999"
    for path in ("groups", "contacts"):
        resp = await admin_client.get(f"/api/v1/admin/{path}?offset={huge}")
        assert resp.status_code == 422
