/**
 * The build pipeline writes control lines into the build log to tell the timeline which phase and
 * step runs:
 *
 *   ::loop-runtime:: phase=install step=install-deps level=info msg="Install deps starting"
 *
 * They are not output of the customer's build. The log shows the message such a line carries.
 */
const CONTROL_PREFIX = '::loop-runtime::';
const MESSAGE = /\bmsg="((?:[^"\\]|\\.)*)"/;

/** The text a log line shows: the message of a control line, any other line as it is. */
export function readableLogMessage(msg: string): string {
  const trimmed = msg.trimStart();
  if (!trimmed.startsWith(CONTROL_PREFIX)) return msg;
  const message = MESSAGE.exec(trimmed);
  if (message) return message[1].replace(/\\(.)/g, '$1');
  return trimmed.slice(CONTROL_PREFIX.length).trim();
}
