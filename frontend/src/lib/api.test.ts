import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe("api session endpoints", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("createSession posts the offer and returns the answer", async () => {
    const offer = { sdp: "offer-sdp", type: "offer" };
    const answer = { session_id: "abc123", sdp: "answer-sdp", type: "answer" };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(answer));
    vi.stubGlobal("fetch", fetchMock);

    const result = await api.createSession(offer);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/sessions/create"),
      expect.objectContaining({ method: "POST", body: JSON.stringify(offer) }),
    );
    expect(result).toEqual(answer);
  });

  it("startSession posts to the session's start endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ session_id: "abc123", status: "started" }));
    vi.stubGlobal("fetch", fetchMock);

    await api.startSession("abc123");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/sessions/abc123/start"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("stopSession posts to the session's stop endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ session_id: "abc123", status: "stopped" }));
    vi.stubGlobal("fetch", fetchMock);

    await api.stopSession("abc123");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/sessions/abc123/stop"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("getSession fetches the session's status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ session_id: "abc123", status: "started" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await api.getSession("abc123");

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/sessions/abc123"), expect.anything());
    expect(result).toEqual({ session_id: "abc123", status: "started" });
  });

  it("attaches the JWT when a token is present", async () => {
    localStorage.setItem("token", "test-token");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ session_id: "abc123", status: "started" }));
    vi.stubGlobal("fetch", fetchMock);

    await api.getSession("abc123");

    const [, options] = fetchMock.mock.calls[0];
    expect((options.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
  });

  it("throws with the server-provided detail message on failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ detail: "Session not found" }, false, 404));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.getSession("missing")).rejects.toThrow("Session not found");
  });
});
