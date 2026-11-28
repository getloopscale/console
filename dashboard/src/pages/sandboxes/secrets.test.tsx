import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "@/test/render";

vi.mock("@/hooks/use-auth", () => ({
  useRequireAuth: () => ({ active: true, identity: { id: "test", traits: { email: "u@x.com" } } }),
}));

// The mock is the transport boundary, so the pages run their real queries and mutations.
const mockCloudFetch = vi.fn();
vi.mock("@/lib/http/api", async (original) => ({
  ...(await original<typeof import("@/lib/http/api")>()),
  cloudFetch: (...args: unknown[]) => mockCloudFetch(...args),
}));

import { SandboxSecretsPage } from "./secrets";
import { SandboxTemplatesPage } from "./templates";

const token = { name: "API_TOKEN", created_at: "2026-11-27T10:00:00Z", updated_at: "2026-11-28T09:00:00Z" };

describe("SandboxSecretsPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists secrets by name and never asks the API for a value", async () => {
    mockCloudFetch.mockResolvedValue({ secrets: [token] });
    render(<SandboxSecretsPage />);

    expect(await screen.findByText("API_TOKEN")).toBeInTheDocument();
    expect(mockCloudFetch.mock.calls.map((c) => c[0])).toEqual(["/v1/secrets"]);
  });

  it("creates a secret with a PUT on its name", async () => {
    mockCloudFetch.mockResolvedValue({ secrets: [] });
    const user = userEvent.setup();
    render(<SandboxSecretsPage />);

    await user.click(await screen.findByRole("button", { name: "New secret" }));
    await user.type(screen.getByLabelText("Name"), "DB_URL");
    await user.type(screen.getByLabelText("Value"), "postgres://example");
    await user.click(screen.getByRole("button", { name: "Save secret" }));

    await waitFor(() =>
      expect(mockCloudFetch).toHaveBeenCalledWith(
        "/v1/secrets/DB_URL",
        expect.objectContaining({ method: "PUT", body: JSON.stringify({ value: "postgres://example" }) }),
        { throwOnError: true },
      ),
    );
  });

  it("refuses a name that cannot be an environment variable", async () => {
    mockCloudFetch.mockResolvedValue({ secrets: [] });
    const user = userEvent.setup();
    render(<SandboxSecretsPage />);

    await user.click(await screen.findByRole("button", { name: "New secret" }));
    await user.type(screen.getByLabelText("Name"), "1-bad");
    await user.type(screen.getByLabelText("Value"), "x");

    expect(screen.getByText(/do not start with a digit/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save secret" })).toBeDisabled();
  });

  it("deletes a secret after a confirmation", async () => {
    mockCloudFetch.mockResolvedValue({ secrets: [token] });
    const user = userEvent.setup();
    render(<SandboxSecretsPage />);

    await user.click(await screen.findByRole("button", { name: "Delete secret API_TOKEN" }));
    await user.click(screen.getByRole("button", { name: "Delete secret" }));

    await waitFor(() =>
      expect(mockCloudFetch).toHaveBeenCalledWith("/v1/secrets/API_TOKEN", { method: "DELETE" }, { throwOnError: true }),
    );
  });

  it("says the read failed instead of saying there are no secrets", async () => {
    mockCloudFetch.mockRejectedValue(new Error("boom"));
    render(<SandboxSecretsPage />);

    expect(await screen.findByText("Could not read secrets")).toBeInTheDocument();
  });
});

describe("SandboxTemplatesPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists each template with the call that starts a sandbox from it", async () => {
    mockCloudFetch.mockResolvedValue({
      templates: [
        { name: "python", image: "python:3.12-slim", description: "Python 3.12 runtime (slim).", builtin: true },
        { id: "tpl_1", name: "tools", image: "ghcr.io/acme/tools@sha256:abc", version: "1" },
      ],
    });
    render(<SandboxTemplatesPage />);

    expect(await screen.findByText("Sandbox.create('python')")).toBeInTheDocument();
    expect(screen.getByText("Sandbox.create('tools')")).toBeInTheDocument();
    expect(screen.getByText("Built-in")).toBeInTheDocument();
    expect(screen.getByText("Registered")).toBeInTheDocument();
  });

  it("says the read failed instead of showing an empty table", async () => {
    mockCloudFetch.mockRejectedValue(new Error("boom"));
    render(<SandboxTemplatesPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not read the templates");
  });
});
