// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { attachTerminal, ptyUrl, type TerminalScreen, type TerminalSocket } from './terminal-session';

describe('ptyUrl', () => {
  it('reaches the page host over wss when the API has no origin of its own', () => {
    expect(ptyUrl('', 'sbx_1', { protocol: 'https:', host: 'app.example.test' })).toBe(
      'wss://app.example.test/v1/sandboxes/sbx_1/pty',
    );
  });

  it('keeps the host of an API on another origin and maps http to ws', () => {
    expect(ptyUrl('http://localhost:8090', 'sbx 1', { protocol: 'https:', host: 'app.example.test' })).toBe(
      'ws://localhost:8090/v1/sandboxes/sbx%201/pty',
    );
  });
});

function rig() {
  const socket: TerminalSocket = { send: vi.fn(), close: vi.fn(), onopen: null, onmessage: null, onclose: null };
  let typed: (data: string) => void = () => {};
  let resized: (size: { rows: number; cols: number }) => void = () => {};
  const screen: TerminalScreen = {
    rows: 24,
    cols: 80,
    write: vi.fn(),
    onData: (listener) => {
      typed = listener;
    },
    onResize: (listener) => {
      resized = listener;
    },
  };
  const status = vi.fn();
  const detach = attachTerminal(socket, screen, status);
  return { socket, screen, status, detach, type: (d: string) => typed(d), resize: (r: number, c: number) => resized({ rows: r, cols: c }) };
}

describe('attachTerminal', () => {
  it('sends the size of the screen when the socket opens', () => {
    const r = rig();

    r.socket.onopen?.();

    expect(r.socket.send).toHaveBeenCalledWith('{"type":"resize","rows":24,"cols":80}');
    expect(r.status).toHaveBeenLastCalledWith('open');
  });

  it('writes what the sandbox prints to the screen', () => {
    const r = rig();
    const bytes = new TextEncoder().encode('ok\r\n').buffer;

    r.socket.onmessage?.({ data: bytes });

    expect(r.screen.write).toHaveBeenCalledWith(new Uint8Array(bytes));
  });

  it('sends what is typed as bytes, and a new size as a resize message', () => {
    const r = rig();
    r.socket.onopen?.();

    r.type('echo ok\r');
    r.resize(30, 100);

    expect(r.socket.send).toHaveBeenCalledWith(new TextEncoder().encode('echo ok\r'));
    expect(r.socket.send).toHaveBeenLastCalledWith('{"type":"resize","rows":30,"cols":100}');
  });

  it('sends nothing before the socket opens or after it closes', () => {
    const r = rig();

    r.type('early');
    r.socket.onopen?.();
    r.socket.onclose?.();
    r.type('late');

    expect(r.socket.send).toHaveBeenCalledTimes(1); // the first resize
    expect(r.status).toHaveBeenLastCalledWith('closed');
  });

  it('closes the socket when detached', () => {
    const r = rig();

    r.detach();

    expect(r.socket.close).toHaveBeenCalled();
  });
});
