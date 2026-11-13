import 'reflect-metadata';
import { win32 } from 'node:path';
import {
  readPnpm10GlobalInventory,
  pnpm10DepPathToFilename,
} from './pnpm10-global-inventory';
import { pnpm10InventoryFixture } from '../__fixtures__/pnpm10/inventory';
import { P10 } from '../__fixtures__/pnpm10/config';
import { expectGlobalReason } from '../__fixtures__/global-adapters';
import { assertGlobalPackageMutable } from '../policy/global-policy';

describe('pnpm 10 static direct-dependency inventory', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9])(
    'matches F5b b%i list --json direct rows',
    async (step) => {
      const h = await pnpm10InventoryFixture(step);
      const result = await readPnpm10GlobalInventory(h.location, h.deps);
      expect(
        result.packages.map(({ name, version }) => ({ name, version })),
      ).toEqual(
        Object.entries(h.snapshot.list[0].dependencies ?? {})
          .map(([name, d]) => ({ name, version: d.version }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      expect(result.ownershipComplete).toBe(true);
      expect(result.pnpm10Inventory?.project.dependencies).toHaveLength(
        result.packages.length,
      );
      expect(h.spawn).not.toHaveBeenCalled();
      expect(
        h.open.mock.calls.some(
          ([p]) =>
            !p.toLowerCase().startsWith(P10.root.toLowerCase()) &&
            !p.toLowerCase().startsWith(P10.home.toLowerCase()) &&
            /linksrc/i.test(p),
        ),
      ).toBe(false);
      const linked = result.packages.find((p) => p.name === 'f5b-local-tool');
      if (step === 6 || step === 7)
        expect(linked).toMatchObject({
          status: 'linked',
          reason: 'LINKED_PACKAGE',
        });
      else expect(linked).toBeUndefined();
    },
  );
  it('keeps retained versions, transitive junctions and stale local bins ancillary, including empty b9', async () => {
    const h = await pnpm10InventoryFixture(9);
    const r = await readPnpm10GlobalInventory(h.location, h.deps);
    expect(r.packages).toEqual([]);
    expect(
      r.pnpm10Inventory?.project.ancillary.some((a) =>
        a.identity.path.includes('is-number@7.0.0'),
      ),
    ).toBe(true);
    expect(
      r.pnpm10Inventory?.project.ancillary.some((a) =>
        a.identity.path.includes('\\.bin\\'),
      ),
    ).toBe(true);
    expect(r.pnpm10Inventory?.project.missingPaths).toContain(
      `${P10.root}\\node_modules\\.pnpm\\lock.yaml`,
    );
  });
  it('supports an absent global project as empty, pinning absence', async () => {
    const h = await pnpm10InventoryFixture(9);
    for (const path of h.entries.keys())
      if (
        path === P10.root.toLowerCase() ||
        path.startsWith(`${P10.root.toLowerCase()}\\`)
      )
        h.entries.delete(path);
    const r = await readPnpm10GlobalInventory(h.location, h.deps);
    expect(r.packages).toEqual([]);
    expect(r.ownershipComplete).toBe(true);
    expect(r.pnpm10Inventory?.project.missingPaths).toContain(P10.root);
  });
  it.each([
    'manifest',
    'wanted',
    'current',
    'modules',
    'workspace',
    'extra-link',
    'duplicate',
  ])('refuses inconsistent metadata: %s', async (kind) => {
    const h = await pnpm10InventoryFixture(2);
    const file = (suffix: string) => `${P10.root}\\${suffix}`;
    if (kind === 'manifest')
      h.put(file('package.json'), {
        text: '{"dependencies":{"semver":"0.0.1"}}',
      });
    if (kind === 'wanted')
      h.put(file('pnpm-lock.yaml'), {
        text: h.snapshot.files['pnpm-lock.yaml'].replace('7.7.3', '7.7.4'),
      });
    if (kind === 'current')
      h.put(file('node_modules\\.pnpm\\lock.yaml'), {
        text: "lockfileVersion: '9.0'\nimporters: { '.': {} }",
      });
    if (kind === 'modules')
      h.put(file('node_modules\\.modules.yaml'), {
        text: h.snapshot.files['node_modules/.modules.yaml'].replace(
          'isolated',
          'hoisted',
        ),
      });
    if (kind === 'workspace')
      h.put(file('node_modules\\.pnpm-workspace-state-v1.json'), {
        text: '{"pnpmfiles":["evil.cjs"]}',
      });
    if (kind === 'extra-link')
      h.put(file('node_modules\\unexpected'), {
        link: true,
        real: 'E:\\TEST\\foreign',
      });
    if (kind === 'duplicate')
      h.put(file('package.json'), {
        text: '{"dependencies":{},"dependencies":{}}',
      });
    await expectGlobalReason(
      () => readPnpm10GlobalInventory(h.location, h.deps),
      'INVENTORY_FAILED',
    );
  });
  it('refuses redirected direct links before external reads and link replacement after validation', async () => {
    const h = await pnpm10InventoryFixture(1);
    const link = `${P10.root}\\node_modules\\semver`;
    h.put(link, { link: true, real: 'E:\\TEST\\outside' });
    await expectGlobalReason(
      () => readPnpm10GlobalInventory(h.location, h.deps),
      'INVENTORY_FAILED',
    );
    expect(h.open.mock.calls.some(([p]) => p.startsWith('E:'))).toBe(false);
    const r = await pnpm10InventoryFixture(1);
    const original = r.realpath.getMockImplementation()!;
    let times = 0;
    r.realpath.mockImplementation((p) =>
      p.toLowerCase() === link.toLowerCase() && ++times > 1
        ? Promise.resolve('E:\\TEST\\replaced')
        : original(p),
    );
    await expectGlobalReason(
      () => readPnpm10GlobalInventory(r.location, r.deps),
      'INVENTORY_FAILED',
    );
  });
  it('marks malformed/colliding shim families read-only without losing rows', async () => {
    const h = await pnpm10InventoryFixture(1);
    h.put(`${P10.home}\\semver.exe`, { bytes: new Uint8Array([0, 255, 0]) });
    const r = await readPnpm10GlobalInventory(h.location, h.deps);
    expect(r.packages).toEqual([
      expect.objectContaining({
        name: 'semver',
        status: 'invalid',
        reason: 'BIN_CONFLICT',
      }),
    ]);
    expect(r.ownershipComplete).toBe(false);
  });
  // Real globals carry tens of thousands of package files in R\.pnpm. Only the
  // virtual-store structure (<id>\node_modules\<name|@scope\name>) is pinned.
  it('never enumerates package contents inside the virtual store', async () => {
    const h = await pnpm10InventoryFixture(3);
    const semver = `${P10.root}\\.pnpm\\semver@7.7.3\\node_modules\\semver`;
    const once = `${P10.root}\\.pnpm\\@tootallnate+once@2.0.0\\node_modules\\@tootallnate\\once`;
    h.put(`${semver}\\functions\\TEST.js`, { text: '// TEST package file' });
    h.put(`${once}\\dist\\TEST.js`, { text: '// TEST package file' });
    const result = await readPnpm10GlobalInventory(h.location, h.deps);
    expect(result.packages.map((p) => p.name)).toEqual([
      '@tootallnate/once',
      'is-number',
      'semver',
    ]);
    const listed = h.readdir.mock.calls.map(([path]) =>
      String(path).toLowerCase(),
    );
    for (const packageDir of [semver, once])
      expect(
        listed.filter(
          (path) =>
            path === packageDir.toLowerCase() ||
            path.startsWith(`${packageDir.toLowerCase()}\\`),
        ),
      ).toEqual([]);
    expect(listed).toContain(
      `${P10.root}\\.pnpm\\@tootallnate+once@2.0.0\\node_modules\\@tootallnate`.toLowerCase(),
    );
  });

  it('bounds file/entry/row/depth budgets and propagates cancellation', async () => {
    const h = await pnpm10InventoryFixture(1);
    h.put(`${P10.root}\\package.json`, { text: ' '.repeat(1024 * 1024 + 1) });
    await expectGlobalReason(
      () => readPnpm10GlobalInventory(h.location, h.deps),
      'LIMIT_EXCEEDED',
    );
    const e = await pnpm10InventoryFixture(1);
    e.readdir.mockResolvedValue(
      Array.from({ length: 40_001 }, (_, i) => `TEST${i}`),
    );
    await expect(
      readPnpm10GlobalInventory(e.location, e.deps),
    ).rejects.toThrow();
    const rows = await pnpm10InventoryFixture(1);
    rows.put(`${P10.root}\\package.json`, {
      text: JSON.stringify({
        dependencies: Object.fromEntries(
          Array.from({ length: 10_001 }, (_, i) => [`test-${i}`, '1.0.0']),
        ),
      }),
    });
    await expectGlobalReason(
      () => readPnpm10GlobalInventory(rows.location, rows.deps),
      'LIMIT_EXCEEDED',
    );
    const deep = await pnpm10InventoryFixture(1);
    deep.put(`${P10.root}\\package.json`, {
      text: '{"x":'.repeat(65) + '{}' + '}'.repeat(65),
    });
    await expectGlobalReason(
      () => readPnpm10GlobalInventory(deep.location, deep.deps),
      'LIMIT_EXCEEDED',
    );
    const c = await pnpm10InventoryFixture();
    c.controller.abort(new Error('TEST abort'));
    await expect(readPnpm10GlobalInventory(c.location, c.deps)).rejects.toThrow(
      'TEST abort',
    );
  });

  it.each(['store', 'virtual', 'manifest-version', 'missing-current'])(
    'refuses contradictory installation facts: %s',
    async (kind) => {
      const h = await pnpm10InventoryFixture(1);
      if (kind === 'store' || kind === 'virtual') {
        const modules = JSON.parse(
          h.snapshot.files['node_modules/.modules.yaml'],
        ) as Record<string, unknown>;
        modules[kind === 'store' ? 'storeDir' : 'virtualStoreDir'] =
          'E:\\TEST\\foreign';
        h.put(`${P10.root}\\node_modules\\.modules.yaml`, {
          text: JSON.stringify(modules),
        });
      }
      if (kind === 'manifest-version')
        h.put(
          `${P10.root}\\.pnpm\\semver@7.7.3\\node_modules\\semver\\package.json`,
          { text: '{"name":"semver","version":"7.7.4"}' },
        );
      if (kind === 'missing-current')
        h.entries.delete(
          `${P10.root}\\node_modules\\.pnpm\\lock.yaml`.toLowerCase(),
        );
      await expectGlobalReason(
        () => readPnpm10GlobalInventory(h.location, h.deps),
        'INVENTORY_FAILED',
      );
      expect(h.open.mock.calls.some(([p]) => p.startsWith('E:'))).toBe(false);
    },
  );

  it('keeps inventory correct when old virtual-store cache entries have been pruned', async () => {
    const h = await pnpm10InventoryFixture(9);
    for (const path of [...h.entries.keys()])
      if (path.startsWith(`${P10.root}\\.pnpm\\`.toLowerCase()))
        h.entries.delete(path);
    const modules = JSON.parse(
      h.snapshot.files['node_modules/.modules.yaml'],
    ) as Record<string, unknown>;
    modules.prunedAt = 'Fri, 01 Jan 2021 00:00:00 GMT';
    h.put(`${P10.root}\\node_modules\\.modules.yaml`, {
      text: JSON.stringify(modules),
    });
    const r = await readPnpm10GlobalInventory(h.location, h.deps);
    expect(r.packages).toEqual([]);
    expect(r.ownershipComplete).toBe(true);
  });

  it('reserves arbitrary foreign names without poisoning valid package protection inputs', async () => {
    const h = await pnpm10InventoryFixture(1);
    h.put(`${P10.home}\\foreign file.txt`, { text: 'TEST reserved' });
    const r = await readPnpm10GlobalInventory(h.location, h.deps);
    const fact = r.facts[0];
    expect(r.ownershipComplete).toBe(true);
    expect(
      r.pnpm10Inventory?.binSlots.some(
        (s) => s.name === 'foreign file.txt' && s.owner === null,
      ),
    ).toBe(true);
    expect(() =>
      assertGlobalPackageMutable({
        packageName: fact.name,
        packageRoot: fact.packageRoot,
        linked: false,
        currentBins: fact.bins,
        targetBins: [],
        binOwners: r.binOwners,
        ownershipComplete: r.ownershipComplete,
        protectedPaths: [],
      }),
    ).not.toThrow();
  });

  it('refuses ambiguous package resolutions even when both lockfiles agree', async () => {
    const h = await pnpm10InventoryFixture(1);
    for (const relative of ['pnpm-lock.yaml', 'node_modules/.pnpm/lock.yaml'])
      h.put(win32.join(P10.root, relative), {
        text: h.snapshot.files[relative].replace(
          'resolution: {integrity:',
          'resolution: {directory: ../../foreign, integrity:',
        ),
      });
    await expectGlobalReason(
      () => readPnpm10GlobalInventory(h.location, h.deps),
      'INVENTORY_FAILED',
    );
  });

  it('refuses wanted/current lock settings that disagree', async () => {
    const h = await pnpm10InventoryFixture(1);
    h.put(`${P10.root}\\node_modules\\.pnpm\\lock.yaml`, {
      text: h.snapshot.files['node_modules/.pnpm/lock.yaml'].replace(
        'autoInstallPeers: true',
        'autoInstallPeers: false',
      ),
    });
    await expectGlobalReason(
      () => readPnpm10GlobalInventory(h.location, h.deps),
      'INVENTORY_FAILED',
    );
  });
  it('derives scoped, peer-suffixed and hashed long virtual-store names from pnpm source', async () => {
    expect(pnpm10DepPathToFilename('@test/tool@1.0.0', 60)).toBe(
      '@test+tool@1.0.0',
    );
    expect(pnpm10DepPathToFilename('tool@1.0.0(peer@2.0.0)', 60)).toBe(
      'tool@1.0.0_peer@2.0.0',
    );
    expect(pnpm10DepPathToFilename(`${'a'.repeat(80)}@1.0.0`, 60)).toMatch(
      /^a{27}_[a-f0-9]{32}$/,
    );
    const h = await pnpm10InventoryFixture(1);
    const from = `${P10.root}\\.pnpm\\semver@7.7.3`;
    const to = `${P10.root}\\.pnpm\\semver@7.7.3_peer@1.0.0`;
    for (const [path, value] of [...h.entries])
      if (path.startsWith(from.toLowerCase())) {
        h.entries.delete(path);
        h.put(to + path.slice(from.length), value);
      }
    h.put(`${P10.root}\\node_modules\\semver`, {
      link: true,
      real: `${to}\\node_modules\\semver`,
    });
    for (const relative of ['pnpm-lock.yaml', 'node_modules/.pnpm/lock.yaml'])
      h.put(win32.join(P10.root, relative), {
        text: h.snapshot.files[relative]
          .replace('version: 7.7.3', 'version: 7.7.3(peer@1.0.0)')
          .replace(
            'snapshots:\n\n  semver@7.7.3:',
            'snapshots:\n\n  semver@7.7.3(peer@1.0.0):',
          ),
      });
    // Bin ownership fails safely because the old wrappers still point to the old store.
    const r = await readPnpm10GlobalInventory(h.location, h.deps);
    expect(r.packages[0]).toMatchObject({
      name: 'semver',
      version: '7.7.3',
      reason: 'BIN_CONFLICT',
    });
  });
});
