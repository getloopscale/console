import { useEffect, useRef, useState } from 'react';
import { Button } from '@getloopscale/ui';
import { getApiBase } from '@/lib/http/api';
import { attachTerminal, ptyUrl, type TerminalSocket, type TerminalStatus } from '@/lib/sandboxes/terminal-session';
import '@xterm/xterm/css/xterm.css';

const STATUS_TEXT: Record<TerminalStatus, string> = {
  connecting: 'Connecting to the sandbox…',
  open: 'Connected. The shell starts in /workspace.',
  closed: 'The session ended.',
};

/**
 * A shell in the sandbox. The emulator is loaded when the tab is first opened,
 * and each session is one WebSocket that ends with the tab or the page.
 */
export function TerminalTab({ id, active, running }: { id: string; active: boolean; running: boolean }) {
  const host = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<TerminalStatus>('connecting');
  const [session, setSession] = useState(0);

  useEffect(() => {
    const node = host.current;
    if (!active || !running || !node) return;
    let ended = false;
    let end = () => {};

    void Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]).then(([{ Terminal }, { FitAddon }]) => {
      if (ended) return;
      const terminal = new Terminal({ cursorBlink: true, fontSize: 13, convertEol: false });
      const fit = new FitAddon();
      terminal.loadAddon(fit);
      terminal.open(node);
      fit.fit();

      const socket = new WebSocket(ptyUrl(getApiBase(), id, window.location));
      socket.binaryType = 'arraybuffer';
      const detach = attachTerminal(socket as unknown as TerminalSocket, terminal, setStatus);
      const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => fit.fit());
      observer?.observe(node);
      terminal.focus();

      end = () => {
        observer?.disconnect();
        detach();
        terminal.dispose();
      };
    });

    return () => {
      ended = true;
      end();
    };
  }, [id, active, running, session]);

  if (!running) {
    return (
      <p className="pt-4 text-body-sm text-muted-foreground">
        A terminal needs a running sandbox. Resume this one to open a shell.
      </p>
    );
  }

  return (
    <div className="space-y-2 pt-4">
      <div className="flex items-center justify-between gap-2">
        <p role="status" className="text-label text-muted-foreground">
          {STATUS_TEXT[status]}
        </p>
        {status === 'closed' && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setStatus('connecting');
              setSession((n) => n + 1);
            }}
          >
            Reconnect
          </Button>
        )}
      </div>
      <div
        ref={host}
        key={session}
        aria-label="Sandbox terminal"
        className="h-96 overflow-hidden rounded-md bg-black p-2"
      />
    </div>
  );
}
