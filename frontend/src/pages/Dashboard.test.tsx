import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Dashboard from "./Dashboard";
import { api } from "../lib/api";
import { useVoiceSession } from "../hooks/useVoiceSession";

vi.mock("../lib/api", () => ({
  api: { me: vi.fn() },
}));

vi.mock("../hooks/useVoiceSession", () => ({
  useVoiceSession: vi.fn(),
}));

function mockVoiceSession(overrides: Partial<ReturnType<typeof useVoiceSession>> = {}) {
  vi.mocked(useVoiceSession).mockReturnValue({
    status: "idle",
    error: null,
    remoteStream: null,
    start: vi.fn(),
    stop: vi.fn(),
    ...overrides,
  });
}

describe("Dashboard", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(api.me).mockResolvedValue({ email: "user@example.com" });
  });

  it("shows the Start button and status when idle", async () => {
    mockVoiceSession({ status: "idle" });
    render(<Dashboard />);

    expect(await screen.findByText("Signed in as user@example.com")).toBeInTheDocument();
    expect(screen.getByText("Status: idle")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toBeEnabled();
  });

  it("disables the button while connecting", () => {
    mockVoiceSession({ status: "connecting" });
    render(<Dashboard />);

    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
  });

  it("shows a Stop button that is enabled when active", () => {
    mockVoiceSession({ status: "active" });
    render(<Dashboard />);

    expect(screen.getByRole("button", { name: "Stop" })).toBeEnabled();
  });

  it("disables the Stop button while stopping", () => {
    mockVoiceSession({ status: "stopping" });
    render(<Dashboard />);

    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
  });

  it("renders the error message with role=alert", () => {
    mockVoiceSession({ status: "error", error: "Microphone permission was denied." });
    render(<Dashboard />);

    expect(screen.getByRole("alert")).toHaveTextContent("Microphone permission was denied.");
  });

  it("calls start() when the Start button is clicked", async () => {
    const start = vi.fn();
    mockVoiceSession({ status: "idle", start });
    render(<Dashboard />);

    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(start).toHaveBeenCalled();
  });

  it("calls stop() when the Stop button is clicked", async () => {
    const stop = vi.fn();
    mockVoiceSession({ status: "active", stop });
    render(<Dashboard />);

    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(stop).toHaveBeenCalled();
  });
});
