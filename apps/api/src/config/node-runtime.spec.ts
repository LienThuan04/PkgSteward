import { nodeRuntimeNotice, SUPPORTED_NODE_RANGE } from '@/config/node-runtime';

describe('nodeRuntimeNotice', () => {
  it('pins the officially supported Node range', () => {
    expect(SUPPORTED_NODE_RANGE).toBe('>=22.18.0');
  });

  it.each(['20.20.2', '22.12.0', '22.17.1'])(
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

  it.each(['22.18.0', '22.23.5', '24.19.0', '26.0.0'])(
    'stays silent on Node %s',
    (version) => {
      expect(nodeRuntimeNotice(version)).toBeNull();
    },
  );
});
