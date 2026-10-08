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
});
