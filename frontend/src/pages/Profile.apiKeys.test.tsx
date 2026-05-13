import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Profile } from "./Profile";
import * as api from "../api";

const { mockLogout, mockAuthUser } = vi.hoisted(() => ({
  mockLogout: vi.fn(),
  mockAuthUser: vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: mockAuthUser(),
    logout: mockLogout,
    authEnabled: true,
  }),
}));

vi.mock("../components/Layout", () => ({
  Layout: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

vi.mock("../api", () => ({
  api: {
    put: vi.fn(),
    post: vi.fn(),
  },
  isAxiosError: vi.fn(() => false),
  getCollections: vi.fn(),
  createCollection: vi.fn(),
  updateCollection: vi.fn(),
  deleteCollection: vi.fn(),
  listApiKeys: vi.fn(),
  createApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
}));

const existingApiKey = {
  id: "key-1",
  name: "Existing Key",
  prefix: "exd_key_abc123",
  scopes: ["drawings:read", "drawings:write"],
  createdAt: "2026-05-01T12:00:00.000Z",
  updatedAt: "2026-05-01T12:00:00.000Z",
  lastUsedAt: null,
  revokedAt: null,
};

describe("Profile API keys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthUser.mockReturnValue({ id: "user-1", email: "user@example.com", name: "User One" });
    vi.mocked(api.getCollections).mockResolvedValue([]);
    vi.mocked(api.listApiKeys).mockResolvedValue([existingApiKey]);
    vi.mocked(api.createApiKey).mockResolvedValue({
      apiKey: {
        ...existingApiKey,
        id: "key-2",
        name: "CI Token",
        prefix: "exd_key_new456",
      },
      token: "exd_key_new456.secret-token-value",
    });
    vi.mocked(api.revokeApiKey).mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("lists, creates, copies, and revokes API keys", async () => {
    render(
      <MemoryRouter>
        <Profile />
      </MemoryRouter>
    );

    expect(await screen.findByText("Existing Key")).toBeInTheDocument();
    expect(screen.getByText("exd_key_abc123")).toBeInTheDocument();
    expect(screen.getByText("drawings:read, drawings:write")).toBeInTheDocument();
    expect(screen.getAllByText("Never").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText(/api key name/i), {
      target: { value: "CI Token" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create api key/i }));

    expect(await screen.findByDisplayValue("exd_key_new456.secret-token-value")).toBeInTheDocument();
    expect(screen.getByText(/copy this token now/i)).toBeInTheDocument();
    expect(api.createApiKey).toHaveBeenCalledWith("CI Token");

    fireEvent.click(screen.getByRole("button", { name: /copy generated api token/i }));
    await waitFor(() => {
      expect(navigator.clipboard?.writeText).toHaveBeenCalledWith("exd_key_new456.secret-token-value");
    });

    fireEvent.click(screen.getByRole("button", { name: /done/i }));
    expect(screen.queryByDisplayValue("exd_key_new456.secret-token-value")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /revoke api key ci token/i }));

    await waitFor(() => {
      expect(api.revokeApiKey).toHaveBeenCalledWith("key-2");
    });
    expect(await screen.findByText("API key revoked")).toBeInTheDocument();
  });

  it("does not load or show API key management while password reset is required", async () => {
    mockAuthUser.mockReturnValue({
      id: "user-1",
      email: "user@example.com",
      name: "User One",
      mustResetPassword: true,
    });

    render(
      <MemoryRouter>
        <Profile />
      </MemoryRouter>
    );

    expect(await screen.findByText(/api key management is unavailable until you reset your password/i)).toBeInTheDocument();
    expect(api.listApiKeys).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/api key name/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create api key/i })).not.toBeInTheDocument();
  });

  it("disables API key creation while keys are loading", async () => {
    let resolveApiKeys: (keys: Array<typeof existingApiKey>) => void = () => undefined;
    vi.mocked(api.listApiKeys).mockReturnValue(
      new Promise((resolve) => {
        resolveApiKeys = resolve;
      }),
    );

    render(
      <MemoryRouter>
        <Profile />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText(/api key name/i), {
      target: { value: "CI Token" },
    });

    const createButton = screen.getByRole("button", { name: /create api key/i });
    expect(createButton).toBeDisabled();
    fireEvent.click(createButton);
    expect(api.createApiKey).not.toHaveBeenCalled();

    resolveApiKeys([existingApiKey]);
    expect(await screen.findByText("Existing Key")).toBeInTheDocument();
  });
});
