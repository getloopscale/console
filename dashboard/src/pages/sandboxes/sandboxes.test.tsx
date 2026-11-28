import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "@/test/render";

vi.mock("@/hooks/use-auth", () => ({
  useRequireAuth: () => ({ active: true, identity: { id: "test", traits: { email: "u@x.com" } } }),
}));

// The mock is the transport boundary, so the page runs its real query and mutation.
const mockCloudFetch = vi.fn();
vi.mock("@/lib/http/api", () => ({
  cloudFetch: (...args: unknown[]) => mockCloudFetch(...args),
  engineFetch: (...args: unknown[]) => mockCloudFetch(...args),
}));

import { SandboxesPage } from "./sandboxes";

const open = {
  id: "sbx_open01",
  tenant_id: "t1",
  image: "python:3.12-slim",
  state: "running",
  created_at: "2026-11-27T10:00:00Z",
  expires_at: "2026-11-27T11:00:00Z",
};
const restricted = {
  id: "sbx_locked02",
  tenant_id: "t1",
  image: "node:22-slim",
  state: "paused",
  created_at: "2026-11-27T10:05:00Z",
  network: { allow_out: ["pypi.org"], deny_out: ["0.0.0.0/0"] },
};

describe("SandboxesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists each sandbox with its image, state and outbound network", async () => {
    mockCloudFetch.mockResolvedValue({ sandboxes: [open, restricted] });
    render(<SandboxesPage />);

    await waitFor(() => expect(screen.getByText("sbx_open01")).toBeInTheDocument());
    expect(screen.getByText("sbx_locked02")).toBeInTheDocument();
    expect(screen.getByText("python:3.12-slim")).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText("paused")).toBeInTheDocument();
    expect(screen.getByText("Open internet")).toBeInTheDocument();
    expect(screen.getByText("Restricted")).toBeInTheDocument();
    expect(mockCloudFetch.mock.calls[0][0]).toMatch(/^\/v1\/sandboxes\?/);
  });

  it("narrows the list to the sandbox whose id is searched", async () => {
    mockCloudFetch.mockResolvedValue({ sandboxes: [open, restricted] });
    const user = userEvent.setup();
    render(<SandboxesPage />);

    await user.type(await screen.findByRole("searchbox", { name: "Search by sandbox ID" }), "locked");

    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual(["sbx_locked02"]);
  });

  it("keeps only the paused sandbox when Paused is chosen, and counts every sandbox", async () => {
    mockCloudFetch.mockResolvedValue({ sandboxes: [open, restricted, { ...open, id: "sbx_third03" }] });
    const user = userEvent.setup();
    render(<SandboxesPage />);

    await user.click(await screen.findByRole("button", { name: "Paused 1" }));

    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual(["sbx_locked02"]);
    expect(screen.getByTestId("concurrent-sandboxes")).toHaveTextContent("3 concurrent sandboxes");
  });

  it("reverses the order of the start time from the header", async () => {
    mockCloudFetch.mockResolvedValue({ sandboxes: [open, restricted] });
    const user = userEvent.setup();
    render(<SandboxesPage />);
    const ids = () => screen.getAllByRole("link").map((a) => a.textContent);

    await screen.findByText("sbx_open01");
    expect(ids()).toEqual(["sbx_locked02", "sbx_open01"]);
    await user.click(screen.getByRole("button", { name: /^Started/ }));
    expect(ids()).toEqual(["sbx_open01", "sbx_locked02"]);
  });

  it("links each sandbox to its page and shows its labels", async () => {
    mockCloudFetch.mockResolvedValue({ sandboxes: [{ ...open, metadata: { suite: "demo" } }] });
    render(<SandboxesPage />);

    expect(await screen.findByRole("link", { name: "sbx_open01" })).toHaveAttribute("href", "/sandboxes/sbx_open01");
    expect(screen.getByText("suite=demo")).toBeInTheDocument();
  });

  it("says how to create one when there are none", async () => {
    mockCloudFetch.mockResolvedValue({ sandboxes: [] });
    render(<SandboxesPage />);

    await waitFor(() => expect(screen.getByText("No sandboxes running")).toBeInTheDocument());
    expect(screen.getByText(/loopsandbox SDK/)).toBeInTheDocument();
  });

  it("does not call a failed read an empty list", async () => {
    mockCloudFetch.mockRejectedValue(new Error("503"));
    render(<SandboxesPage />);

    await waitFor(() => expect(screen.getByText("Could not read sandboxes")).toBeInTheDocument());
  });

  it("terminates a sandbox only after the confirmation", async () => {
    mockCloudFetch.mockResolvedValue({ sandboxes: [open] });
    const user = userEvent.setup();
    render(<SandboxesPage />);

    await user.click(await screen.findByRole("button", { name: "Terminate sbx_open01" }));
    expect(mockCloudFetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);

    await user.click(screen.getByRole("button", { name: "Terminate sandbox" }));
    await waitFor(() =>
      expect(mockCloudFetch).toHaveBeenCalledWith(
        "/v1/sandboxes/sbx_open01",
        expect.objectContaining({ method: "DELETE" }),
        expect.anything(),
      ),
    );
  });
});
