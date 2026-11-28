import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { render, screen, waitFor } from "@/test/render";

vi.mock("@/hooks/use-auth", () => ({
  useRequireAuth: () => ({ active: true, identity: { id: "test", traits: { email: "u@x.com" } } }),
}));

// The mock is the transport boundary, so the page runs its real queries and mutations.
const mockCloudFetch = vi.fn();
vi.mock("@/lib/http/api", async (original) => ({
  ...(await original<typeof import("@/lib/http/api")>()),
  cloudFetch: (...args: unknown[]) => mockCloudFetch(...args),
}));

import { ApiError } from "@/lib/http/api";
import { SandboxDetailPage } from "./sandbox-detail";

const sandbox = {
  id: "sbx_one01",
  image: "python:3.12-slim",
  state: "running",
  created_at: "2026-11-27T10:00:00Z",
  expires_at: "2026-11-27T11:00:00Z",
  metadata: { suite: "demo" },
};

/** Answers each route of one sandbox; `over` replaces an answer by "METHOD path-suffix". */
function serve(over: Record<string, unknown> = {}) {
  mockCloudFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${path.replace("/v1/sandboxes/sbx_one01", "").split("?")[0]}`;
    const answers: Record<string, unknown> = {
      "GET ": sandbox,
      "GET /network/denials": { denials: [] },
      "GET /logs": { entries: [], next: 0, truncated: false },
      ...over,
    };
    if (!(key in answers)) return null;
    const answer = answers[key];
    if (answer instanceof Error) throw answer;
    return answer;
  });
}

function open() {
  return render(
    <Routes>
      <Route path="/sandboxes/:id" element={<SandboxDetailPage />} />
      <Route path="/sandboxes" element={<p>the list</p>} />
    </Routes>,
    { initialEntries: ["/sandboxes/sbx_one01"] },
  );
}

const called = (method: string, suffix: string) =>
  mockCloudFetch.mock.calls.find(
    ([path, init]) => path === `/v1/sandboxes/sbx_one01${suffix}` && (init?.method ?? "GET") === method,
  );

describe("SandboxDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the state, the image, the network and the labels of the sandbox", async () => {
    serve();
    open();

    expect(await screen.findByText("python:3.12-slim")).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText("Open internet")).toBeInTheDocument();
    expect(screen.getByText("suite=demo")).toBeInTheDocument();
  });

  it("pauses a running sandbox", async () => {
    serve();
    const user = userEvent.setup();
    open();

    await user.click(await screen.findByRole("button", { name: "Pause" }));

    await waitFor(() => expect(called("POST", "/pause")).toBeTruthy());
  });

  it("offers Resume, and not Pause, for a paused sandbox", async () => {
    serve({ "GET ": { ...sandbox, state: "paused" } });
    const user = userEvent.setup();
    open();

    await user.click(await screen.findByRole("button", { name: "Resume" }));

    await waitFor(() => expect(called("POST", "/resume")).toBeTruthy());
    expect(screen.queryAllByRole("button", { name: "Pause" })).toHaveLength(0);
  });

  it("says why when the sandbox cannot be paused", async () => {
    serve({
      "POST /pause": new ApiError(501, {
        error: { code: "not_implemented", message: "pause/resume is not supported by this runtime" },
      }),
    });
    const user = userEvent.setup();
    open();

    await user.click(await screen.findByRole("button", { name: "Pause" }));

    expect(await screen.findByText(/pause\/resume is not supported by this runtime/)).toBeInTheDocument();
  });

  it("kills the sandbox only after the confirmation, then goes back to the list", async () => {
    serve();
    const user = userEvent.setup();
    open();

    await user.click(await screen.findByRole("button", { name: "Kill" }));
    expect(called("DELETE", "")).toBeFalsy();
    await user.click(screen.getByRole("button", { name: "Kill sandbox" }));

    await waitFor(() => expect(called("DELETE", "")).toBeTruthy());
    expect(await screen.findByText("the list")).toBeInTheDocument();
  });

  it("replaces the outbound rules with the ones typed, one per line", async () => {
    serve({ "PUT /network": { allow_out: ["pypi.org"], deny_out: ["0.0.0.0/0"] } });
    const user = userEvent.setup();
    open();

    await user.type(await screen.findByRole("textbox", { name: "Allowed destinations" }), "pypi.org\n files.pythonhosted.org ");
    await user.type(screen.getByRole("textbox", { name: "Denied destinations" }), "0.0.0.0/0");
    await user.click(screen.getByRole("button", { name: "Apply rules" }));

    await waitFor(() => expect(called("PUT", "/network")).toBeTruthy());
    expect(JSON.parse(called("PUT", "/network")![1].body)).toEqual({
      allow_out: ["pypi.org", "files.pythonhosted.org"],
      deny_out: ["0.0.0.0/0"],
    });
  });

  it("lists the connections the rules refused", async () => {
    serve({
      "GET /network/denials": {
        denials: [{ time: "2026-11-27T10:01:00Z", destination: "93.184.216.34:443", host: "example.com", reason: "denied by rule" }],
      },
    });
    open();

    expect(await screen.findByText("example.com")).toBeInTheDocument();
    expect(screen.getByText("93.184.216.34:443")).toBeInTheDocument();
    expect(screen.getByText("denied by rule")).toBeInTheDocument();
  });

  it("shows the output of the sandbox in the Logs tab", async () => {
    serve({
      "GET /logs": {
        entries: [{ pid: 3, stream: "stdout", data: "server ready\n", at: "2026-11-27T10:00:02Z" }],
        next: 1,
        truncated: false,
      },
    });
    const user = userEvent.setup();
    open();

    await user.click(await screen.findByRole("tab", { name: "Logs" }));

    expect(await screen.findByText(/server ready/)).toBeInTheDocument();
  });

  it("shows the memory and the disk in use in the Monitoring tab", async () => {
    serve({
      "GET /metrics": {
        at: "2026-11-27T10:00:03Z",
        cpu_usage_ns: 1_000_000_000,
        memory_used_bytes: 64 * 1024 * 1024,
        memory_limit_bytes: 512 * 1024 * 1024,
        disk_used_bytes: 1024 * 1024,
        disk_limit_bytes: 64 * 1024 * 1024,
      },
    });
    const user = userEvent.setup();
    open();

    await user.click(await screen.findByRole("tab", { name: "Monitoring" }));

    await waitFor(() => expect(screen.getByTestId("memory-now")).toHaveTextContent("64 MiB of 512 MiB"));
    expect(screen.getByTestId("disk-now")).toHaveTextContent("1 MiB of 64 MiB");
  });

  it("walks the workspace in the Filesystem tab and offers each file for download", async () => {
    mockCloudFetch.mockImplementation(async (path: string) => {
      if (path === "/v1/sandboxes/sbx_one01") return sandbox;
      if (path.endsWith("/files?path=%2Fworkspace"))
        return { files: [{ name: "a b.txt", size: 2048, is_dir: false }, { name: "src", size: 0, is_dir: true }] };
      if (path.endsWith("/files?path=%2Fworkspace%2Fsrc"))
        return { files: [{ name: "main.py", size: 10, is_dir: false }] };
      return { denials: [], entries: [] };
    });
    const user = userEvent.setup();
    open();

    await user.click(await screen.findByRole("tab", { name: "Filesystem" }));
    expect(await screen.findByRole("link", { name: "Download a b.txt" })).toHaveAttribute(
      "href",
      expect.stringMatching(/\/v1\/sandboxes\/sbx_one01\/files\/workspace\/a%20b\.txt$/),
    );
    expect(screen.getByText("2 KiB")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open directory src" }));
    expect(await screen.findByRole("link", { name: "Download main.py" })).toHaveAttribute(
      "href",
      expect.stringMatching(/\/files\/workspace\/src\/main\.py$/),
    );

    await user.click(screen.getByRole("button", { name: "workspace" }));
    expect(await screen.findByRole("link", { name: "Download a b.txt" })).toBeInTheDocument();
  });

  it("says the sandbox no longer exists instead of showing an empty page", async () => {
    serve({ "GET ": new Error("sandbox not found") });
    open();

    expect(await screen.findByText("Sandbox not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to sandboxes" })).toHaveAttribute("href", "/sandboxes");
  });
});
