// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readableLogMessage } from './pipeline-control-line';

describe('readableLogMessage', () => {
  it('shows the message a control line carries', () => {
    expect(
      readableLogMessage('::loop-runtime:: phase=install step=install-deps level=info msg="Install deps starting"'),
    ).toBe('Install deps starting');
  });

  it('reads an escaped quote inside the message', () => {
    expect(readableLogMessage('::loop-runtime:: phase=build msg="Running \\"npm run build\\""')).toBe(
      'Running "npm run build"',
    );
  });

  it('drops the marker of a control line with no message', () => {
    expect(readableLogMessage('::loop-runtime:: phase=clone step=validate-workspace')).toBe(
      'phase=clone step=validate-workspace',
    );
  });

  it('leaves the output of the build as it is', () => {
    expect(readableLogMessage('npm warn deprecated msg="x"')).toBe('npm warn deprecated msg="x"');
    expect(readableLogMessage('echo ::loop-runtime:: in the middle')).toBe('echo ::loop-runtime:: in the middle');
  });
});
