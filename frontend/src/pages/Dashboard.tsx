import { useEffect, useState } from "react";
import { api } from "../lib/api";

export default function Dashboard() {
  const [user, setUser] = useState<{ email: string } | null>(null);

  useEffect(() => {
    api.me().then(setUser).catch(() => setUser(null));
  }, []);

  return (
    <div>
      <h1>Interview Helper</h1>
      {user ? <p>Signed in as {user.email}</p> : <p>Loading…</p>}
      {/* This is where you'd mount the mic/session UI that connects
          to the /api/interview/ws/{session_id} WebSocket. */}
    </div>
  );
}
