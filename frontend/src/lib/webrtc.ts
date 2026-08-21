import { api } from "./api";

export interface VoiceConnection {
  pc: RTCPeerConnection;
  sessionId: string;
  localStream: MediaStream;
  remoteStream: MediaStream;
}

export function waitForIceGatheringComplete(pc: RTCPeerConnection, timeoutMs = 10000): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pc.removeEventListener("icegatheringstatechange", onStateChange);
      reject(new Error("Timed out waiting for ICE gathering to complete"));
    }, timeoutMs);

    function onStateChange() {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(timer);
        pc.removeEventListener("icegatheringstatechange", onStateChange);
        resolve();
      }
    }

    pc.addEventListener("icegatheringstatechange", onStateChange);
  });
}

function stopStream(stream: MediaStream) {
  stream.getTracks().forEach((track) => track.stop());
}

export async function startVoiceSession(
  onRemoteTrack: (stream: MediaStream) => void,
  onDisconnected: () => void,
): Promise<VoiceConnection> {
  const localStream = await navigator.mediaDevices.getUserMedia({ audio: true });

  const pc = new RTCPeerConnection();
  const remoteStream = new MediaStream();

  try {
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

    pc.ontrack = (event) => {
      remoteStream.addTrack(event.track);
      onRemoteTrack(remoteStream);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        onDisconnected();
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGatheringComplete(pc);

    const localDescription = pc.localDescription;
    if (!localDescription) {
      throw new Error("Missing local description after ICE gathering");
    }

    const { session_id, sdp, type } = await api.createSession({
      sdp: localDescription.sdp,
      type: localDescription.type,
    });

    await pc.setRemoteDescription({ sdp, type });
    await api.startSession(session_id);

    return { pc, sessionId: session_id, localStream, remoteStream };
  } catch (err) {
    stopStream(localStream);
    pc.close();
    throw err;
  }
}

export async function stopVoiceSession(conn: VoiceConnection): Promise<void> {
  try {
    await api.stopSession(conn.sessionId);
  } catch {
    // non-fatal: session may already be gone server-side
  }
  conn.pc.close();
  stopStream(conn.localStream);
}
