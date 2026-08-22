import { useCallback, useEffect, useRef, useState } from "react";
import { startVoiceSession, stopVoiceSession, type VoiceConnection } from "../lib/webrtc";

export type VoiceSessionStatus = "idle" | "connecting" | "active" | "stopping" | "error";

export function mapVoiceError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : undefined;
  if (name === "NotAllowedError") return "Microphone permission was denied.";
  if (name === "NotFoundError") return "No microphone was found.";
  if (err instanceof TypeError) return "Could not reach the server.";
  if (err instanceof Error) return err.message;
  return "An unexpected error occurred.";
}

export function useVoiceSession() {
  const [status, setStatus] = useState<VoiceSessionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const connRef = useRef<VoiceConnection | null>(null);

  const handleDisconnected = useCallback(() => {
    connRef.current = null;
    setRemoteStream(null);
    setStatus("idle");
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setStatus("connecting");
    try {
      const conn = await startVoiceSession((stream) => setRemoteStream(stream), handleDisconnected);
      connRef.current = conn;
      setStatus("active");
    } catch (err) {
      setError(mapVoiceError(err));
      setStatus("error");
    }
  }, [handleDisconnected]);

  const stop = useCallback(async () => {
    const conn = connRef.current;
    if (!conn) return;
    setStatus("stopping");
    try {
      await stopVoiceSession(conn);
    } finally {
      connRef.current = null;
      setRemoteStream(null);
      setStatus("idle");
    }
  }, []);

  useEffect(() => {
    return () => {
      if (connRef.current) {
        stopVoiceSession(connRef.current);
        connRef.current = null;
      }
    };
  }, []);

  return { status, error, remoteStream, start, stop };
}
