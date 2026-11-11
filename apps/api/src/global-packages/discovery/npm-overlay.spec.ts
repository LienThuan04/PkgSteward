import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { win32 } from 'node:path';
import { readNpmSelfFacts, summarizeNpmVersion } from './npm-overlay';
import { assertNpmOverlayMutable } from '../policy/npm-overlay';
import { npmDiscoveryFixture } from '../__fixtures__/npm-overlay/discovery';
import { expectGlobalReason } from '../__fixtures__/global-adapters';

const read = (
  fixture: ReturnType<typeof npmDiscoveryFixture>,
  signal = new AbortController().signal,
) =>
  readNpmSelfFacts(
    { location: fixture.location, nodeVersion: '24.19.0', signal },
    { fs: fixture.fs },
  );

describe('static npm-self discovery', () => {
  it('observes an absent overlay and preserves bundled delegation without spawning or listing', async () => {
    const fixture = npmDiscoveryFixture();
    fixture.location.tool.identities.push({
      path: fixture.location.tool.file,
      stat: await fixture.fs.lstat(fixture.location.tool.file),
    });
    const facts = await read(fixture);
    expect(facts.bundledIdentities[0].file.path).toBe(
      fixture.location.tool.file,
    );
    expect(facts.bundledIdentities[0].file).not.toBe(
      fixture.location.tool.identities[0],
    );
    expect(facts.overlay).toBeNull();
    expect(facts.shims.every(({ entry }) => entry === null)).toBe(true);
    expect(facts.retired).toEqual([]);
    expect(facts.repairTargets).toEqual([]);
    expect(summarizeNpmVersion(facts)).toEqual({
      bundledVersion: '11.17.0',
      overlayVersion: null,
      terminalVersion: '11.17.0',
      prefix: fixture.location.prefix,
      overlayState: 'absent',
      delegation: 'verified',
      reason: null,
    });
    expect(fixture.readdir).not.toHaveBeenCalled();
    expect(fixture.readFile).not.toHaveBeenCalled();
    expect(fixture.open.mock.calls.map(([path]) => path)).not.toContain(
      fixture.prefixScript,
    );
  });
  it.each([8, 9] as const)(
    'proves all six cmd-shim %s overlay members and pins bytes/identity',
    async (shape) => {
      const fixture = npmDiscoveryFixture(shape);
      const facts = await read(fixture);
      expect(summarizeNpmVersion(facts)).toMatchObject({
        overlayState: 'present',
        terminalVersion: '12.2.2',
        reason: null,
      });
      expect(facts.overlay?.package?.bins).toEqual([
        { name: 'npm', target: 'bin/npm-cli.js' },
        { name: 'npx', target: 'bin/npx-cli.js' },
      ]);
      expect(facts.overlay?.package?.binIdentities).toHaveLength(2);
      const entry = facts.shims[0].entry!;
      expect(entry.sha256).toBe(
        createHash('sha256').update(entry.text!).digest('hex'),
      );
      expect(entry.identity.stat.size).toBe(Buffer.byteLength(entry.text!));
    },
  );
  it.each([
    'missing',
    'invalid-json',
    'wrong-name',
    'invalid-version',
    'invalid-bin',
    'oversize',
    'linked',
    'missing-cli',
  ])(
    'keeps invalid manifest/package %s as broken, readable recovery facts',
    async (variant) => {
      const fixture = npmDiscoveryFixture(9);
      const path = win32.join(fixture.overlay, 'package.json');
      if (variant === 'missing') fixture.remove(path);
      else if (variant === 'missing-cli')
        fixture.remove(win32.join(fixture.overlay, 'bin', 'npm-cli.js'));
      else
        fixture.put(
          path,
          variant === 'linked'
            ? { link: true, real: 'D:\\TEST\\foreign.json' }
            : {
                text:
                  variant === 'invalid-json'
                    ? '{'
                    : variant === 'oversize'
                      ? ' '.repeat(1024 * 1024 + 1)
                      : JSON.stringify({
                          name: variant === 'wrong-name' ? 'foreign' : 'npm',
                          version:
                            variant === 'invalid-version'
                              ? 'v12.2.2'
                              : '12.2.2',
                          bin:
                            variant === 'invalid-bin'
                              ? { npm: '../escape' }
                              : {
                                  npm: 'bin/npm-cli.js',
                                  npx: 'bin/npx-cli.js',
                                },
                        }),
              },
        );
      const facts = await read(fixture);
      expect(facts.overlay?.package).toBeNull();
      expect(summarizeNpmVersion(facts).overlayState).toBe('broken');
      expect(facts.repairTargets.map(({ path }) => path)).toContain(
        fixture.overlay,
      );
    },
  );
  it('marks an incomplete S set broken and exposes only observed repair paths', async () => {
    const fixture = npmDiscoveryFixture(8);
    fixture.remove(win32.join(fixture.location.binDir, 'npx.ps1'));
    const facts = await read(fixture);
    expect(summarizeNpmVersion(facts).overlayState).toBe('broken');
    expect(facts.repairTargets).toHaveLength(6);
  });
  it.each([
    {
      type: 'directory',
      path: 'D:\\TEST\\prefix\\node_modules\\.npm-p9Z75ZzS',
    },
    {
      type: 'directory',
      path: 'D:\\TEST\\prefix\\node_modules\\.npm-lzMu51qr',
    },
    { type: 'file', path: 'D:\\TEST\\prefix\\.npm.cmd-Zw77o3M1' },
    { type: 'file', path: 'D:\\TEST\\prefix\\.npm.cmd-Nax2v5hx' },
  ] as const)(
    'detects exact retired artifacts for both drive-letter spellings %p without a glob',
    async ({ type, path }) => {
      const fixture = npmDiscoveryFixture();
      fixture.put(
        path,
        type === 'directory'
          ? { directory: true }
          : { text: 'TEST truncated retired shim' },
      );
      fixture.put(win32.join(fixture.location.prefix!, '.npm-unrelated'), {
        directory: true,
      });
      const facts = await read(fixture);
      expect(facts.retired.map(({ path }) => path)).toEqual([path]);
      expect(facts.repairTargets.map(({ path }) => path)).toEqual([path]);
      expect(summarizeNpmVersion(facts).overlayState).toBe('broken');
      expect(fixture.readdir).not.toHaveBeenCalled();
    },
  );
  it('reports a linked overlay without opening its manifest', async () => {
    const fixture = npmDiscoveryFixture();
    fixture.put(fixture.overlay, {
      link: true,
      directory: true,
      real: 'D:\\TEST\\foreign',
    });
    const facts = await read(fixture);
    expect(summarizeNpmVersion(facts)).toMatchObject({
      overlayState: 'linked',
      reason: 'LINKED_PACKAGE',
    });
    expect(facts.overlay?.package).toBeNull();
  });
  it.each(['foreign', 'oversize', 'directory', 'linked', 'empty'])(
    'retains physical %s shim facts for policy refusal/recovery',
    async (variant) => {
      const fixture = npmDiscoveryFixture();
      const path = win32.join(fixture.location.binDir, 'npm.cmd');
      fixture.put(
        path,
        variant === 'directory'
          ? { directory: true }
          : variant === 'linked'
            ? { link: true, real: 'D:\\TEST\\foreign' }
            : {
                text:
                  variant === 'empty'
                    ? ''
                    : variant === 'oversize'
                      ? 'x'.repeat(65537)
                      : 'TEST foreign shim',
              },
      );
      const facts = await read(fixture);
      expect(summarizeNpmVersion(facts).overlayState).toBe('broken');
      expect(
        facts.shims.find(({ name }) => name === 'npm.cmd')?.entry,
      ).not.toBeNull();
      expect(facts.repairTargets.map(({ path }) => path)).toEqual(
        variant === 'empty' ? [path] : [],
      );
      if (variant === 'oversize')
        expect(fixture.open.mock.calls.map(([file]) => file)).not.toContain(
          path,
        );
    },
  );
  it('classifies overlapping P=N before reading an overlay', async () => {
    const fixture = npmDiscoveryFixture();
    fixture.location.prefix = fixture.nodeDir;
    fixture.location.binDir = fixture.nodeDir;
    fixture.location.globalRoot = win32.join(fixture.nodeDir, 'node_modules');
    const facts = await read(fixture);
    expect(summarizeNpmVersion(facts)).toMatchObject({
      overlayState: 'unsupported',
      reason: 'NPM_PREFIX_IS_NODE_DIR',
    });
    expect(facts.overlay).toBeNull();
    expect(fixture.open.mock.calls.map(([file]) => file)).not.toContain(
      win32.join(fixture.location.tool.packageDir, 'package.json'),
    );
  });
  it.each(['edited', 'missing', 'invalid-utf8', 'oversize'] as const)(
    'reports %s Node shim as unverified, retaining overlay state',
    async (variant) => {
      const fixture = npmDiscoveryFixture();
      const path = win32.join(fixture.nodeDir, 'npm.cmd');
      if (variant === 'missing') fixture.remove(path);
      else
        fixture.put(
          path,
          variant === 'invalid-utf8'
            ? { bytes: new Uint8Array([0xc3, 0x28]) }
            : {
                text:
                  variant === 'oversize'
                    ? 'x'.repeat(65537)
                    : 'TEST edited Node shim',
              },
        );
      expect(summarizeNpmVersion(await read(fixture))).toMatchObject({
        overlayState: 'absent',
        delegation: 'unverified',
        reason: 'NPM_DELEGATION_UNVERIFIED',
      });
    },
  );
  it('honors abort immediately after an awaited filesystem read', async () => {
    const fixture = npmDiscoveryFixture();
    const controller = new AbortController();
    const original = fixture.lstat.getMockImplementation()!;
    fixture.lstat.mockImplementationOnce(async (path) => {
      const stat = await original(path);
      controller.abort(new Error('TEST aborted read'));
      return stat;
    });
    await expect(read(fixture, controller.signal)).rejects.toThrow(
      'TEST aborted read',
    );
    expect(fixture.open).not.toHaveBeenCalled();
  });
  it('closes an opened handle when cancellation arrives during chunk reading', async () => {
    const fixture = npmDiscoveryFixture();
    const controller = new AbortController();
    const original = fixture.open.getMockImplementation()!;
    const close = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
    fixture.open.mockImplementationOnce(async (path) => {
      const handle = await original(path);
      return {
        ...handle,
        close,
        async *readChunks(signal: AbortSignal) {
          for await (const chunk of handle.readChunks(signal)) {
            yield chunk;
            controller.abort(new Error('TEST abort during chunks'));
          }
        },
      };
    });
    await expect(read(fixture, controller.signal)).rejects.toThrow(
      'TEST abort during chunks',
    );
    expect(close).toHaveBeenCalledTimes(1);
    expect(fixture.open).toHaveBeenCalledTimes(1);
  });
  it('does not treat permission errors as an absent overlay', async () => {
    const fixture = npmDiscoveryFixture();
    const original = fixture.lstat.getMockImplementation()!;
    fixture.lstat.mockImplementation((path) =>
      path === fixture.overlay
        ? Promise.reject(
            Object.assign(new Error('TEST denied'), { code: 'EACCES' }),
          )
        : original(path),
    );
    await expectGlobalReason(() => read(fixture), 'INVENTORY_FAILED');
  });
  it('propagates manifest read permission failures instead of calling them invalid JSON', async () => {
    const fixture = npmDiscoveryFixture(9);
    const original = fixture.open.getMockImplementation()!;
    fixture.open.mockImplementation((path) =>
      path === win32.join(fixture.overlay, 'package.json')
        ? Promise.reject(
            Object.assign(new Error('TEST denied manifest'), {
              code: 'EACCES',
            }),
          )
        : original(path),
    );
    await expectGlobalReason(() => read(fixture), 'INVENTORY_FAILED');
  });
  it('refuses a shim identity changed between observation and bounded reading', async () => {
    const fixture = npmDiscoveryFixture();
    const path = win32.join(fixture.nodeDir, 'npm');
    const original = fixture.lstat.getMockImplementation()!;
    let first = true;
    fixture.lstat.mockImplementation(async (file) => {
      const stat = await original(file);
      if (file === path && first) {
        first = false;
        return { ...stat, ino: 12345 };
      }
      return stat;
    });
    await expectGlobalReason(() => read(fixture), 'INVENTORY_FAILED');
  });
  it('records the on-disk name of a retired artifact so a wrong-case hash is refused (G2-1)', async () => {
    const fixture = npmDiscoveryFixture();
    const exact = 'D:\\TEST\\prefix\\node_modules\\.npm-p9Z75ZzS';
    const onDisk = 'D:\\TEST\\prefix\\node_modules\\.npm-P9Z75ZZS';
    // NTFS: lstat ignores case, realpath returns the stored name.
    fixture.put(exact, { directory: true, real: onDisk });
    const facts = await read(fixture);
    expect(facts.retired.map(({ path }) => path)).toEqual([onDisk]);
    expect(summarizeNpmVersion(facts).overlayState).toBe('broken');
    expect(() => assertNpmOverlayMutable('repair', facts)).toThrow(
      expect.objectContaining({
        details: { reason: 'BIN_CONFLICT' },
      }) as Error,
    );
  });
  it('reports a manifest that turned unreadable mid-read as changed, not broken (G2-3)', async () => {
    const fixture = npmDiscoveryFixture(9);
    const manifest = win32.join(fixture.overlay, 'package.json');
    const original = fixture.lstat.getMockImplementation()!;
    let calls = 0;
    fixture.lstat.mockImplementation(async (path) => {
      const stat = await original(path);
      // Grows past the limit right after the first observation.
      return path === manifest && ++calls > 1
        ? { ...stat, size: 2 * 1024 * 1024 }
        : stat;
    });
    await expectGlobalReason(() => read(fixture), 'INVENTORY_FAILED');
  });
  it('maps failures inside the overlay to INVENTORY_FAILED, not LOCATION_AMBIGUOUS (G2-2)', async () => {
    const fixture = npmDiscoveryFixture(9);
    const bin = win32.join(fixture.overlay, 'bin');
    const original = fixture.lstat.getMockImplementation()!;
    fixture.lstat.mockImplementation((path) =>
      path === bin
        ? Promise.reject(
            Object.assign(new Error('TEST denied bin'), { code: 'EACCES' }),
          )
        : original(path),
    );
    await expectGlobalReason(() => read(fixture), 'INVENTORY_FAILED');
  });
  it('still reports Node-dir delegation for an unsupported overlapping layout (G2-4)', async () => {
    const fixture = npmDiscoveryFixture();
    fixture.location.protectedPaths = [fixture.location.prefix!];
    const facts = await read(fixture);
    expect(summarizeNpmVersion(facts)).toMatchObject({
      overlayState: 'unsupported',
      delegation: 'verified',
    });
  });
  it('reports a missing npm-prefix.js as unverified delegation (G2-5)', async () => {
    const fixture = npmDiscoveryFixture();
    fixture.remove(fixture.prefixScript);
    expect(summarizeNpmVersion(await read(fixture))).toMatchObject({
      overlayState: 'absent',
      delegation: 'unverified',
      reason: 'NPM_DELEGATION_UNVERIFIED',
    });
  });
  it('treats a dangling overlay link as linked and a file overlay as broken without targets (G2-5)', async () => {
    const dangling = npmDiscoveryFixture();
    dangling.put(dangling.overlay, { link: true, directory: true });
    const original = dangling.realpath.getMockImplementation()!;
    dangling.realpath.mockImplementation((path) =>
      path === dangling.overlay
        ? Promise.reject(
            Object.assign(new Error('TEST gone'), { code: 'ENOENT' }),
          )
        : original(path),
    );
    expect(summarizeNpmVersion(await read(dangling)).overlayState).toBe(
      'linked',
    );
    const file = npmDiscoveryFixture();
    file.put(file.overlay, { text: 'TEST not a directory' });
    const facts = await read(file);
    expect(summarizeNpmVersion(facts).overlayState).toBe('broken');
    expect(facts.repairTargets).toEqual([]);
  });
  it('retains the existing refusal for an uninitialized prefix root', async () => {
    const fixture = npmDiscoveryFixture();
    fixture.remove(fixture.location.globalRoot);
    await expectGlobalReason(() => read(fixture), 'LOCATION_AMBIGUOUS');
  });
});
