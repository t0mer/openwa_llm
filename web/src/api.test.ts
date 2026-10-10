import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, setUnauthorizedHandler } from "./api";

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
