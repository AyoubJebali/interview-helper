import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mapVoiceError, useVoiceSession } from "./useVoiceSession";
import { startVoiceSession, stopVoiceSession } from "../lib/webrtc";

vi.mock("../lib/webrtc", () => ({
  startVoiceSession: vi.fn(),
  stopVoiceSession: vi.fn(),
}));

describe("mapVoiceError", () => {
  it("maps NotAllowedError to a permission message", () => {
    const err = Object.assign(new DOMException("denied", "NotAllowedError"));
    expect(mapVoiceError(err)).toBe("Microphone permission was denied.");
  });

  it("maps NotFoundError to a no-microphone message", () => {
    const err = new DOMException("no device", "NotFoundError");
    expect(mapVoiceError(err)).toBe("No microphone was found.");
  });

  it("maps a TypeError (fetch network failure) to a server-unreachable message", () => {
    expect(mapVoiceError(new TypeError("Failed to fetch"))).toBe("Could not reach the server.");
  });

  it("falls back to the error's own message", () => {
    expect(mapVoiceError(new Error("Session not found"))).toBe("Session not found");
  });

  it("falls back to a generic message for non-Error values", () => {
    expect(mapVoiceError("oops")).toBe("An unexpected error occurred.");
  });
});

describe("useVoiceSession", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("goes idle -> connecting -> active on a successful start", async () => {
    const fakeConn = { pc: {}, sessionId: "s1", localStream: {}, remoteStream: {} };
    vi.mocked(startVoiceSession).mockResolvedValue(fakeConn as never);

    const { result } = renderHook(() => useVoiceSession());
    expect(result.current.status).toBe("idle");

    act(() => {
      result.current.start();
    });
    expect(result.current.status).toBe("connecting");

    await waitFor(() => expect(result.current.status).toBe("active"));
    expect(result.current.error).toBeNull();
  });

  it("goes to error state with a mapped message when start fails", async () => {
    vi.mocked(startVoiceSession).mockRejectedValue(new DOMException("denied", "NotAllowedError"));

    const { result } = renderHook(() => useVoiceSession());

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("Microphone permission was denied.");
  });

  it("stop() calls stopVoiceSession and returns to idle", async () => {
    const fakeConn = { pc: {}, sessionId: "s1", localStream: {}, remoteStream: {} };
    vi.mocked(startVoiceSession).mockResolvedValue(fakeConn as never);
    vi.mocked(stopVoiceSession).mockResolvedValue(undefined);

    const { result } = renderHook(() => useVoiceSession());
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.status).toBe("active");

    await act(async () => {
      await result.current.stop();
    });

    expect(stopVoiceSession).toHaveBeenCalledWith(fakeConn);
    expect(result.current.status).toBe("idle");
    expect(result.current.remoteStream).toBeNull();
  });

  it("stop() is a no-op when there is no active connection", async () => {
    const { result } = renderHook(() => useVoiceSession());

    await act(async () => {
      await result.current.stop();
    });

    expect(stopVoiceSession).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });

  it("cleans up an active connection on unmount", async () => {
    const fakeConn = { pc: {}, sessionId: "s1", localStream: {}, remoteStream: {} };
    vi.mocked(startVoiceSession).mockResolvedValue(fakeConn as never);
    vi.mocked(stopVoiceSession).mockResolvedValue(undefined);

    const { result, unmount } = renderHook(() => useVoiceSession());
    await act(async () => {
      await result.current.start();
    });

    unmount();

    expect(stopVoiceSession).toHaveBeenCalledWith(fakeConn);
  });
});
