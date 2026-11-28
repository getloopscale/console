/** The part of a WebSocket the terminal uses. */
export interface TerminalSocket {
  send(data: string | Uint8Array): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
}

/** The part of the terminal emulator the session uses. */
export interface TerminalScreen {
  rows: number;
  cols: number;
  write(data: Uint8Array): void;
  onData(listener: (data: string) => void): void;
  onResize(listener: (size: { rows: number; cols: number }) => void): void;
}

export type TerminalStatus = 'connecting' | 'open' | 'closed';

/**
 * The WebSocket address of the terminal of a sandbox. An empty `apiBase` means
 * the API is served by the host of the page.
 */
export function ptyUrl(apiBase: string, id: string, page: { protocol: string; host: string }): string {
  const origin = apiBase || `${page.protocol}//${page.host}`;
  return `${origin.replace(/^http/, 'ws').replace(/\/+$/, '')}/v1/sandboxes/${encodeURIComponent(id)}/pty`;
}

const resizeMessage = (rows: number, cols: number) => JSON.stringify({ type: 'resize', rows, cols });

/**
 * Joins a socket and a screen: binary frames are terminal bytes in both
 * directions and a text frame carries a new window size. Returns what ends
 * the session.
 */
export function attachTerminal(
  socket: TerminalSocket,
  screen: TerminalScreen,
  onStatus: (status: TerminalStatus) => void,
): () => void {
  const encoder = new TextEncoder();
  let open = false;

  socket.onopen = () => {
    open = true;
    socket.send(resizeMessage(screen.rows, screen.cols));
    onStatus('open');
  };
  socket.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) screen.write(new Uint8Array(event.data));
  };
  socket.onclose = () => {
    open = false;
    onStatus('closed');
  };
  screen.onData((data) => {
    if (open) socket.send(encoder.encode(data));
  });
  screen.onResize(({ rows, cols }) => {
    if (open) socket.send(resizeMessage(rows, cols));
  });

  return () => {
    open = false;
    socket.close();
  };
}
