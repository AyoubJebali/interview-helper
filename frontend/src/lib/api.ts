const API_URL = import.meta.env.VITE_API_URL as string;

function getToken() {
  return localStorage.getItem("token");
}

async function request(path: string, options: RequestInit = {}) {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || "Request failed");
  }
  return res.json();
}

export const api = {
  register: (email: string, password: string, full_name?: string) =>
    request("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password, full_name }) }),

  login: async (email: string, password: string) => {
    const data = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    localStorage.setItem("token", data.access_token);
    return data;
  },

  me: () => request("/api/auth/me"),

  logout: () => localStorage.removeItem("token"),
};
