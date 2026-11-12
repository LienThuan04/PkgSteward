import { readFileSync } from 'fs';
import { join } from 'path';
import {
  nodeRuntimeNotice,
  SUPPORTED_NODE_MINIMUM,
  SUPPORTED_NODE_RANGE,
} from '@/config/node-runtime';

describe('nodeRuntimeNotice', () => {
  it('pins the officially supported Node range', () => {
    expect(SUPPORTED_NODE_MINIMUM).toBe('22.18.0');
    expect(SUPPORTED_NODE_RANGE).toBe('>=22.18.0');
  });

  it.each(['20.20.2', '22.12.0', '22.17.1', '22.18.0-pre'])(
    'warns for Node %s and names the running version and the floor',
    (version) => {
      const notice = nodeRuntimeNotice(version);
      expect(notice).toContain(version);
      expect(notice).toContain('22.18');
    },
  );

  it('warns when the version cannot be read', () => {
    expect(nodeRuntimeNotice('not-a-version')).toContain('22.18');
  });

  it.each([
    '22.18.0',
    '22.23.5',
    'v22.18.0',
    '24.19.0',
    '24.0.0-rc.1',
    '26.0.0-nightly20261101abcdef',
  ])('stays silent on Node %s', (version) => {
    expect(nodeRuntimeNotice(version)).toBeNull();
  });

  it('is the first import of main.ts, so it runs before the app loads', () => {
    const main = readFileSync(join(__dirname, '..', 'main.ts'), 'utf8');
    const firstImport = main
      .split(/\r?\n/)
      .find((line) => line.startsWith('import '));
    expect(firstImport).toBe("import '@/node-runtime-check';");
  });
});
