import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, setUnauthorizedHandler } from "./api";
import { setSessionId } from "./session";

function mockFetch(status: number, body: unknown = {}) {
  const fn = vi.fn().mockImplementation(async () =>
    new Response(status === 204 ? null : JSON.stringify(body), { status }),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  setUnauthorizedHandler(null);
  setSessionId(null);
});

describe("api client", () => {
  it("sends the CSRF header, JSON body and same-origin credentials", async () => {
    const fetchMock = mockFetch(200, { managed: true });
    await api.patchGroup("1203@g.us", { managed: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/admin/groups/1203%40g.us");
    expect(init.method).toBe("PATCH");
    expect(init.credentials).toBe("same-origin");
    expect(init.headers["X-Requested-With"]).toBe("admin-ui");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ managed: true });
  });

  it("builds query strings and skips empty values", async () => {
    const fetchMock = mockFetch(200, { items: [], total: 0 });
    await api.listGroups({ search: "a b", managed: false, limit: 50, offset: 0 });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/admin/groups?search=a+b&managed=false&limit=50&offset=0");
    await api.listGroups({ search: "" });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/admin/groups");
  });

  it("calls the unauthorized handler on 401 (not for the login call)", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    mockFetch(401, { detail: "not authenticated" });
    await expect(api.listOptOuts()).rejects.toMatchObject({ status: 401 });
    expect(handler).toHaveBeenCalledTimes(1);
    mockFetch(401, { detail: "invalid password" });
    await expect(api.login("x")).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("returns undefined for 204 and surfaces FastAPI error details", async () => {
    mockFetch(204);
    await expect(api.removeOptOut("1@s.whatsapp.net")).resolves.toBeUndefined();
    mockFetch(422, { detail: [{ msg: "bad a" }, { msg: "bad b" }] });
    await expect(api.addOptOut("x")).rejects.toThrow("bad a; bad b");
  });

  it("maps the load_kb action to the load-kb path", async () => {
    const fetchMock = mockFetch(202, { job_id: "j" });
    await api.runAction("load_kb");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/admin/actions/load-kb");
  });

  it("sends the CSRF header on GET, login and logout", async () => {
    const f = mockFetch(200, { authenticated: true });
    await api.session();
    await api.login("pw");
    await api.logout();
    for (const [, init] of f.mock.calls) expect(init.headers["X-Requested-With"]).toBe("admin-ui");
    expect(f.mock.calls).toHaveLength(3);
  });

  it("uses a string detail as the error message", async () => {
    mockFetch(403, { detail: "forbidden thing" });
    await expect(api.listOptOuts()).rejects.toThrow("forbidden thing");
  });

  it("stringifies array detail items without msg", async () => {
    mockFetch(422, { detail: [{ loc: ["x"] }] });
    await expect(api.addOptOut("x")).rejects.toThrow('{"loc":["x"]}');
  });

  it("falls back to statusText or HTTP status for non-JSON error bodies", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () =>
      new Response("<html>", { status: 502, statusText: "Bad Gateway" })));
    await expect(api.listOptOuts()).rejects.toThrow("Bad Gateway");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () =>
      new Response("<html>", { status: 502 })));
    await expect(api.listOptOuts()).rejects.toThrow("HTTP 502");
  });
});

describe("getStats", () => {
  it("sends from/to as query params and skips missing ones", async () => {
    const fetchMock = mockFetch(200, { messages: 1 });
    await api.getStats({ from: "2026-10-01T00:00:00.000Z", to: "2026-10-08T00:00:00.000Z" });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/v1/admin/stats?from=2026-10-01T00%3A00%3A00.000Z&to=2026-10-08T00%3A00%3A00.000Z",
    );
    await api.getStats({});
    expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/admin/stats");
  });

  it("surfaces errors", async () => {
    mockFetch(422, { detail: "from must be before to" });
    await expect(api.getStats({ from: "x" })).rejects.toMatchObject({ status: 422, message: "from must be before to" });
  });
});

describe("session scoping", () => {
  it("appends the selected session to data calls only", async () => {
    const f = mockFetch(200, { items: [], total: 0 });
    setSessionId("s 1");
    await api.listGroups({ search: "a" });
    await api.getStats({});
    await api.session();
    await api.listSessions();
    await api.getConnection();
    expect(f.mock.calls.map((c) => c[0])).toEqual([
      "/api/v1/admin/groups?search=a&session_id=s+1",
      "/api/v1/admin/stats?session_id=s+1",
      "/api/v1/admin/auth/session",
      "/api/v1/admin/settings/sessions",
      "/api/v1/admin/settings/connection",
    ]);
  });

  it("never sends an empty session_id", async () => {
    const f = mockFetch(200, { items: [], total: 0 });
    await api.listGroups({});
    expect(f.mock.calls[0][0]).toBe("/api/v1/admin/groups");
  });
});

describe("settings endpoints", () => {
  it("uses the settings paths and methods", async () => {
    const f = mockFetch(200, {});
    await api.putConnection({ base_url: "http://x", webhook_url: "", api_key: null, webhook_secret: null });
    await api.testConnection({ base_url: "http://x", api_key: null });
    await api.createSession({ label: "Main", openwa_session_id: "wa" });
    await api.patchSession("a/b", { enabled: false });
    await api.registerWebhook("a/b");
    mockFetch(204);
    await api.deleteSession("a/b");
    const calls = f.mock.calls.map(([url, init]) => `${init.method} ${url}`);
    expect(calls).toEqual([
      "PUT /api/v1/admin/settings/connection",
      "POST /api/v1/admin/settings/connection/test",
      "POST /api/v1/admin/settings/sessions",
      "PATCH /api/v1/admin/settings/sessions/a%2Fb",
      "POST /api/v1/admin/settings/sessions/a%2Fb/webhook",
    ]);
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ base_url: "http://x", webhook_url: "", api_key: null, webhook_secret: null });
  });
});
