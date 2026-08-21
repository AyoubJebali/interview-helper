import { beforeEach, describe, expect, it, vi } from "vitest";
import { startVoiceSession, stopVoiceSession, waitForIceGatheringComplete } from "./webrtc";
import { api } from "./api";

vi.mock("./api", () => ({
  api: {
    createSession: vi.fn(),
    startSession: vi.fn(),
    stopSession: vi.fn(),
  },
}));

class FakeTrack {
  stopped = false;
  stop = vi.fn(() => {
    this.stopped = true;
  });
}

class FakeMediaStream {
  tracks: FakeTrack[];
  constructor(tracks: FakeTrack[] = [new FakeTrack()]) {
    this.tracks = tracks;
  }
  getTracks() {
    return this.tracks;
  }
  addTrack(track: FakeTrack) {
    this.tracks.push(track);
  }
}

class FakePeerConnection {
  iceGatheringState: RTCIceGatheringState = "new";
  connectionState: RTCPeerConnectionState = "new";
  localDescription: RTCSessionDescriptionInit | null = null;
  ontrack: ((event: { track: FakeTrack }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  closed = false;
  addedTracks: FakeTrack[] = [];
  private listeners: Record<string, Array<() => void>> = {};

  addTrack(track: FakeTrack) {
    this.addedTracks.push(track);
  }

  addEventListener(event: string, cb: () => void) {
    (this.listeners[event] ??= []).push(cb);
  }

  removeEventListener(event: string, cb: () => void) {
    this.listeners[event] = (this.listeners[event] ?? []).filter((l) => l !== cb);
  }

  async createOffer() {
    return { sdp: "local-sdp", type: "offer" as RTCSdpType };
  }

  async setLocalDescription(desc: RTCSessionDescriptionInit) {
    this.localDescription = desc;
  }

  async setRemoteDescription(desc: RTCSessionDescriptionInit) {
    void desc;
  }

  close() {
    this.closed = true;
  }

  completeIceGathering() {
    this.iceGatheringState = "complete";
    (this.listeners["icegatheringstatechange"] ?? []).forEach((cb) => cb());
  }
}

describe("waitForIceGatheringComplete", () => {
  it("resolves immediately if already complete", async () => {
    const pc = new FakePeerConnection();
    pc.iceGatheringState = "complete";
    await expect(waitForIceGatheringComplete(pc as unknown as RTCPeerConnection)).resolves.toBeUndefined();
  });

  it("resolves once the state changes to complete", async () => {
    const pc = new FakePeerConnection();
    const promise = waitForIceGatheringComplete(pc as unknown as RTCPeerConnection);
    pc.completeIceGathering();
    await expect(promise).resolves.toBeUndefined();
  });

  it("rejects on timeout", async () => {
    vi.useFakeTimers();
    const pc = new FakePeerConnection();
    const promise = waitForIceGatheringComplete(pc as unknown as RTCPeerConnection, 1000);
    const assertion = expect(promise).rejects.toThrow("Timed out");
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    vi.useRealTimers();
  });
});

describe("startVoiceSession", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("negotiates offer/answer and returns a connection", async () => {
    const localStream = new FakeMediaStream();
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(localStream) } });
    vi.stubGlobal("MediaStream", FakeMediaStream);

    let createdPc: FakePeerConnection | null = null;
    vi.stubGlobal(
      "RTCPeerConnection",
      vi.fn(function RTCPeerConnectionMock(this: unknown) {
        createdPc = new FakePeerConnection();
        return createdPc;
      }),
    );

    vi.mocked(api.createSession).mockResolvedValue({ session_id: "sess-1", sdp: "answer-sdp", type: "answer" });
    vi.mocked(api.startSession).mockResolvedValue({ session_id: "sess-1", status: "started" });

    const onRemoteTrack = vi.fn();
    const onDisconnected = vi.fn();

    const promise = startVoiceSession(onRemoteTrack, onDisconnected);
    // ICE gathering completes asynchronously after createOffer/setLocalDescription.
    await Promise.resolve();
    await Promise.resolve();
    createdPc!.completeIceGathering();

    const conn = await promise;

    expect(api.createSession).toHaveBeenCalledWith({ sdp: "local-sdp", type: "offer" });
    expect(api.startSession).toHaveBeenCalledWith("sess-1");
    expect(conn.sessionId).toBe("sess-1");
    expect(conn.pc).toBe(createdPc);
  });

  it("stops the local mic and closes the connection if negotiation fails", async () => {
    const localStream = new FakeMediaStream();
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(localStream) } });
    vi.stubGlobal("MediaStream", FakeMediaStream);

    let createdPc: FakePeerConnection | null = null;
    vi.stubGlobal(
      "RTCPeerConnection",
      vi.fn(function RTCPeerConnectionMock(this: unknown) {
        createdPc = new FakePeerConnection();
        return createdPc;
      }),
    );

    vi.mocked(api.createSession).mockRejectedValue(new Error("network down"));

    const promise = startVoiceSession(vi.fn(), vi.fn());
    await Promise.resolve();
    await Promise.resolve();
    createdPc!.completeIceGathering();

    await expect(promise).rejects.toThrow("network down");
    expect(localStream.tracks[0].stopped).toBe(true);
    expect(createdPc!.closed).toBe(true);
  });
});

describe("stopVoiceSession", () => {
  it("stops tracks and closes the peer connection even if stopSession fails", async () => {
    vi.mocked(api.stopSession).mockRejectedValue(new Error("already gone"));
    const localStream = new FakeMediaStream();
    const pc = new FakePeerConnection();

    await stopVoiceSession({
      pc: pc as unknown as RTCPeerConnection,
      sessionId: "sess-1",
      localStream: localStream as unknown as MediaStream,
      remoteStream: new FakeMediaStream() as unknown as MediaStream,
    });

    expect(pc.closed).toBe(true);
    expect(localStream.tracks[0].stopped).toBe(true);
  });
});
