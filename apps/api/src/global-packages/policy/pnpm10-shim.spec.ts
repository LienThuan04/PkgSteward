import 'reflect-metadata';
import { win32 } from 'node:path';
import {
  provePnpm10Shim,
  readPnpm10BinDirectory,
  provePnpm10BinSet,
} from './pnpm10-shim';
import { F5B_SHIMS } from '../__fixtures__/pnpm10/shims';
import { P10 } from '../__fixtures__/pnpm10/config';
import { memoryFs, TEST_PATHS } from '../__fixtures__/global-adapters';

const packageRoot = `${P10.root}\\.pnpm\\semver@7.7.3\\node_modules\\semver`;
const target = `${packageRoot}\\bin\\semver.js`;
const nodePaths = [
  `${packageRoot}\\node_modules`,
  win32.dirname(packageRoot),
  `${P10.root}\\.pnpm\\node_modules`,
];
const input = (text: string, extension: string) => ({
  text,
  shimPath: `${P10.home}\\semver${extension}`,
  target,
  nodePath: TEST_PATHS.node,
  nodePaths,
});

describe('pnpm 10 exact shim proof', () => {
  it.each(['', '.cmd', '.ps1'] as const)(
    'proves the complete F5b %s family',
    (ext) => {
      expect(provePnpm10Shim(input(F5B_SHIMS.semver[ext], ext))).toBe(true);
      expect(
        provePnpm10Shim(
          input(F5B_SHIMS.semver[ext].replace(/\n/g, '\r\n'), ext),
        ),
      ).toBe(true);
    },
  );
  it.each(['', '.cmd', '.ps1'] as const)(
    'proves linked relative target without reading it (%s)',
    (ext) => {
      expect(
        provePnpm10Shim({
          ...input(F5B_SHIMS['f5b-local-tool'][ext], ext),
          shimPath: `${P10.home}\\f5b-local-tool${ext}`,
          target: 'D:\\TEST\\linksrc\\f5b-local-tool\\cli.js',
          nodePaths: [`${P10.root}\\.pnpm\\node_modules`],
        }),
      ).toBe(true);
    },
  );
  it.each(['', '.cmd', '.ps1'] as const)(
    'rejects decoy, injected branch, extra argument and prologue drift (%s)',
    (ext) => {
      const text = F5B_SHIMS.semver[ext];
      for (const bad of [
        text
          .replace('bin/semver.js', 'bin/foreign.js')
          .replace('bin\\semver.js', 'bin\\foreign.js'),
        `${text}\necho injected\n`,
        text.replace(/semver\.js"/g, 'semver.js" "extra"'),
        `# target ${target}\n${text.replace(/semver\.js/g, 'foreign.js')}`,
        text.slice(1),
        text.replace('NODE_PATH', 'PATH'),
      ])
        expect(provePnpm10Shim(input(bad, ext))).toBe(false);
      expect(provePnpm10Shim(input('x'.repeat(65537), ext))).toBe(false);
    },
  );

  async function directory(extra: string[] = []) {
    const h = memoryFs();
    h.put(P10.home, { directory: true });
    h.put(`${P10.home}\\global`, { directory: true });
    h.put(`${P10.home}\\store`, { directory: true });
    h.put(`${P10.home}\\foreign.txt`, { text: 'TEST foreign' });
    for (const ext of ['', '.cmd', '.ps1'] as const)
      h.put(`${P10.home}\\semver${ext}`, { text: F5B_SHIMS.semver[ext] });
    for (const name of extra)
      h.put(`${P10.home}\\${name}`, { text: 'TEST conflict' });
    h.readdir.mockResolvedValue([
      'global',
      'store',
      'foreign.txt',
      'semver',
      'semver.cmd',
      'semver.ps1',
      ...extra,
    ]);
    const controller = new AbortController();
    const deps = {
      fs: h.fs,
      signal: controller.signal,
      binDir: P10.home,
      budget: { remaining: 32 * 1024 * 1024 },
    };
    const result = await readPnpm10BinDirectory(deps);
    return { ...h, result, deps, controller };
  }

  it('enumerates B=H completely, reserving infrastructure/foreign slots', async () => {
    const h = await directory();
    expect(h.result.complete).toBe(true);
    expect(h.result.slots).toHaveLength(6);
    expect(h.result.slots.every((s) => s.owner === null)).toBe(true);
    expect(
      h.result.slots
        .filter((s) => ['global', 'store'].includes(s.name))
        .every((s) => s.realPath === null),
    ).toBe(true);
    expect(
      provePnpm10BinSet({
        directory: h.result,
        binName: 'semver',
        target,
        nodePath: TEST_PATHS.node,
        nodePaths,
      }),
    ).toHaveLength(3);
    expect(h.open.mock.calls.some(([p]) => /\\(?:global|store)$/.test(p))).toBe(
      false,
    );
  });
  it('rejects partial families, case clash and native collisions at candidate slots', async () => {
    for (const extra of ['semver.CMD', 'semver.exe']) {
      const h = await directory([extra]);
      h.put(`${P10.home}\\${extra}`, { text: 'TEST conflict' });
      const d = await readPnpm10BinDirectory(h.deps);
      expect(
        provePnpm10BinSet({
          directory: d,
          binName: 'semver',
          target,
          nodePath: TEST_PATHS.node,
          nodePaths,
        }),
      ).toBeNull();
    }
    const h = await directory();
    h.readdir.mockResolvedValue(['semver', 'semver.cmd']);
    const d = await readPnpm10BinDirectory(h.deps);
    expect(
      provePnpm10BinSet({
        directory: d,
        binName: 'semver',
        target,
        nodePath: TEST_PATHS.node,
        nodePaths,
      }),
    ).toBeNull();
    expect(
      provePnpm10BinSet({
        directory: d,
        binName: 'store',
        target,
        nodePath: TEST_PATHS.node,
        nodePaths,
      }),
    ).toBeNull();
  });
  it('caps shim reads, refuses replacement and propagates abort', async () => {
    const h = await directory();
    h.put(`${P10.home}\\semver.cmd`, { text: 'x'.repeat(65537) });
    const d = await readPnpm10BinDirectory(h.deps);
    expect(
      provePnpm10BinSet({
        directory: d,
        binName: 'semver',
        target,
        nodePath: TEST_PATHS.node,
        nodePaths,
      }),
    ).toBeNull();
    h.controller.abort(new Error('TEST abort'));
    await expect(readPnpm10BinDirectory(h.deps)).rejects.toThrow('TEST abort');
  });

  it('reserves an unrelated binary file with no extension without blocking enumeration', async () => {
    const h = await directory();
    h.put(`${P10.home}\\foreign`, { bytes: new Uint8Array([255, 254]) });
    h.readdir.mockResolvedValue([
      'global',
      'store',
      'foreign',
      'semver',
      'semver.cmd',
      'semver.ps1',
    ]);
    const d = await readPnpm10BinDirectory(h.deps);
    expect(d.complete).toBe(true);
    expect(d.slots.find((s) => s.name === 'foreign')?.owner).toBeNull();
    expect(
      provePnpm10BinSet({
        directory: d,
        binName: 'semver',
        target,
        nodePath: TEST_PATHS.node,
        nodePaths,
      }),
    ).toHaveLength(3);
  });
});
