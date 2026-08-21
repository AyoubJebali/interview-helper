import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useVoiceSession } from "../hooks/useVoiceSession";

export default function Dashboard() {
  const [user, setUser] = useState<{ email: string } | null>(null);
  const { status, error, remoteStream, start, stop } = useVoiceSession();
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    api.me().then(setUser).catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  const busy = status === "connecting" || status === "stopping";

  return (
    <div>
      <h1>Interview Helper</h1>
      {user ? <p>Signed in as {user.email}</p> : <p>Loading…</p>}

      <section>
        <h2>Voice Session</h2>
        <p>Status: {status}</p>
        {error && <p role="alert">{error}</p>}
        {status === "active" ? (
          <button onClick={stop} disabled={busy}>
            Stop
          </button>
        ) : (
          <button onClick={start} disabled={busy}>
            Start
          </button>
        )}
        <audio ref={audioRef} autoPlay hidden />
      </section>
    </div>
  );
}
