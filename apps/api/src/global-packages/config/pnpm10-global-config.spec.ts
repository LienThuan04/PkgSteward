import 'reflect-metadata';
import { win32 } from 'node:path';
import { readPnpm10GlobalConfig } from './pnpm10-global-config';
import { config10Fixture, P10 } from '../__fixtures__/pnpm10/config';
import { expectGlobalReason } from '../__fixtures__/global-adapters';
import {
  GLOBAL_CONFIG_FILE_LIMIT,
  GLOBAL_CONFIG_TOTAL_LIMIT,
} from './global-config';

describe('pnpm 10 inert configuration', () => {
  it('derives independent Windows defaults, pins sources/absences, and never probes', async () => {
    const h = config10Fixture();
    const c = await readPnpm10GlobalConfig(h.deps);
    expect(c).toMatchObject({
      homeDir: P10.home,
      globalRoot: P10.root,
      binDir: P10.home,
      storeDir: null,
      cacheDir: `${P10.local}\\pnpm-cache`,
      stateDir: `${P10.local}\\pnpm-state`,
      configDir: P10.config,
    });
    expect(c.missingConfigPaths).toEqual(
      expect.arrayContaining([
        `${P10.profile}\\.npmrc`,
        `${P10.cwd}\\etc\\npmrc`,
        `${P10.config}\\rc`,
        `${h.deps.tool.packageDir}\\dist\\pnpmrc`,
        `${P10.root}\\package.json`,
        `${P10.root}\\.pnpmfile.cjs`,
        'C:\\Program Files\\nodejs\\node_modules\\npmrc',
      ]),
    );
    expect(h.readFile).not.toHaveBeenCalled();
  });

  it('uses npm namespace case-insensitively, D/rc and explicit H/B/G/S/C/T independently', async () => {
    const h = config10Fixture({
      NPM_CONFIG_GLOBAL_BIN_DIR: 'D:\\TEST\\bins',
      NPM_CONFIG_USERCONFIG: 'D:\\TEST\\user.npmrc',
      PATH: 'D:\\TEST\\bins',
      pnpm_config_global_dir: 'E:\\ignored',
      pnpm_config_pnpmfile: 'ignored',
    });
    h.put('D:\\TEST\\bins', { directory: true });
    h.put('D:\\TEST\\user.npmrc', {
      text: '//registry.npmjs.org/:_authToken=TEST-secret\nregistry=https://registry.npmjs.org/',
    });
    h.put(`${P10.config}\\rc`, {
      text: 'global-dir=D:\\TEST\\global10\nstore-dir=D:\\TEST\\s\ncache-dir=D:\\TEST\\c\nstate-dir=D:\\TEST\\t',
    });
    h.put(`${P10.config}\\config.yaml`, { text: 'pnpmfile: unsafe.cjs' });
    const c = await readPnpm10GlobalConfig(h.deps);
    expect(c).toMatchObject({
      globalRoot: 'D:\\TEST\\global10\\5',
      binDir: 'D:\\TEST\\bins',
      storeDir: 'D:\\TEST\\s\\v10',
      cacheDir: 'D:\\TEST\\c',
      stateDir: 'D:\\TEST\\t',
      policy: { publicAuthPresent: true },
    });
    expect(JSON.stringify(c)).not.toContain('TEST-secret');
    expect(c.configIdentities.every((f) => f.sha256.length === 64)).toBe(true);
    expect(h.open.mock.calls.some(([p]) => p.endsWith('config.yaml'))).toBe(
      false,
    );
  });

  it.each([
    [
      { XDG_DATA_HOME: 'D:\\TEST\\data', PNPM_HOME: undefined },
      'D:\\TEST\\data\\pnpm',
    ],
    [{ PNPM_HOME: undefined }, `${P10.local}\\pnpm`],
    [
      { PNPM_HOME: undefined, LOCALAPPDATA: undefined },
      `${P10.profile}\\.pnpm`,
    ],
  ] as const)(
    'derives data home without treating it as a bin fallback (%j)',
    async (patch, expected) => {
      const h = config10Fixture({
        ...patch,
        npm_config_global_bin_dir: P10.home,
      });
      expect((await readPnpm10GlobalConfig(h.deps)).homeDir).toBe(expected);
    },
  );

  it('pins explicitly selected globalconfig, bundled npmrc and project pnpm policy', async () => {
    const h = config10Fixture({
      npm_config_globalconfig: 'D:\\TEST\\global.npmrc',
    });
    h.put('D:\\TEST\\global.npmrc', {
      text: '@private:registry=https://example.test/',
    });
    h.put(`${P10.root}\\package.json`, {
      text: JSON.stringify({ pnpm: { onlyBuiltDependencies: ['semver'] } }),
    });
    h.put(`${h.deps.tool.packageDir}\\dist\\pnpmrc`, {
      text: 'registry=https://registry.npmjs.org/',
    });
    const c = await readPnpm10GlobalConfig(h.deps);
    expect(c.globalConfig).toBe('D:\\TEST\\global.npmrc');
    expect(c.policy).toMatchObject({
      scopedRegistries: ['@private'],
      changeUnsupported: true,
    });
    expect(c.configIdentities.map((f) => f.file.path)).toContain(
      `${P10.root}\\package.json`,
    );
  });

  it.each([
    { PNPM_HOME: undefined },
    { PATH: 'D:\\TEST\\other' },
    { PNPM_HOME: 'D:\\TEST\\absent', PATH: 'D:\\TEST\\absent' },
  ])('refuses unconfigured bin without creating it (%j)', async (env) => {
    const h = config10Fixture(env);
    await expectGlobalReason(
      () => readPnpm10GlobalConfig(h.deps),
      'PNPM_GLOBAL_NOT_CONFIGURED',
    );
  });

  it.each([
    'global-dir=${HOME}\\g',
    'global-dir=relative',
    'global-dir=\\\\host\\share',
    'pnpmfile=hook.cjs',
    'configDependencies[]=evil',
    'global-dir[]=D:\\TEST\\g',
    'global-dir=D:\\TEST\\a\nglobal_dir=D:\\TEST\\b',
    'global-dir=D:\\TEST\\a\nglobal-dir=D:\\TEST\\b',
    'prefix=D:\\TEST\\redirect',
    'registry=${SECRET}',
  ])('refuses dynamic, executable or ambiguous rc (%s)', async (text) => {
    const h = config10Fixture();
    h.put(`${P10.config}\\rc`, { text });
    await expectGlobalReason(
      () => readPnpm10GlobalConfig(h.deps),
      'CONFIG_UNSUPPORTED',
    );
  });

  it.each(['.pnpmfile.cjs', 'package.json'])(
    'refuses project hooks/config plugins (%s)',
    async (name) => {
      const h = config10Fixture();
      h.put(`${P10.root}\\${name}`, {
        text:
          name === 'package.json'
            ? '{"pnpm":{"configDependencies":{"evil":"1"}}}'
            : 'throw 1',
      });
      await expectGlobalReason(
        () => readPnpm10GlobalConfig(h.deps),
        'CONFIG_UNSUPPORTED',
      );
    },
  );

  it('refuses conflicting environment aliases and redirected ancestors/files', async () => {
    const h = config10Fixture({
      npm_config_global_dir: 'D:\\TEST\\a',
      NPM_CONFIG_GLOBAL_DIR: 'D:\\TEST\\b',
    });
    await expectGlobalReason(
      () => readPnpm10GlobalConfig(h.deps),
      'CONFIG_UNSUPPORTED',
    );
    const r = config10Fixture();
    r.put(`${P10.config}\\rc`, { text: '', real: 'E:\\TEST\\rc' });
    await expectGlobalReason(
      () => readPnpm10GlobalConfig(r.deps),
      'CONFIG_UNSUPPORTED',
    );
    const a = config10Fixture();
    a.checkDirectory.mockRejectedValue(new Error('TEST redirected ancestor'));
    await expectGlobalReason(
      () => readPnpm10GlobalConfig(a.deps),
      'CONFIG_UNSUPPORTED',
    );
  });

  it('detects file replacement during a handle read', async () => {
    const h = config10Fixture();
    const file = `${P10.config}\\rc`;
    h.put(file, { text: '' });
    const original = h.lstat.getMockImplementation()!;
    let seen = 0;
    h.lstat.mockImplementation(async (p) => {
      const stat = await original(p);
      return p === file && ++seen > 1 ? { ...stat, ino: 99 } : stat;
    });
    await expectGlobalReason(
      () => readPnpm10GlobalConfig(h.deps),
      'CONFIG_UNSUPPORTED',
    );
  });

  it('bounds bytes and propagates cancellation', async () => {
    const h = config10Fixture();
    h.put(`${P10.config}\\rc`, {
      text: '#'.repeat(GLOBAL_CONFIG_FILE_LIMIT + 1),
    });
    await expectGlobalReason(
      () => readPnpm10GlobalConfig(h.deps),
      'LIMIT_EXCEEDED',
    );
    const e = config10Fixture({
      npm_config_registry: 'x'.repeat(GLOBAL_CONFIG_TOTAL_LIMIT + 1),
    });
    await expectGlobalReason(
      () => readPnpm10GlobalConfig(e.deps),
      'LIMIT_EXCEEDED',
    );
    const c = config10Fixture();
    c.controller.abort(new Error('TEST abort'));
    await expect(readPnpm10GlobalConfig(c.deps)).rejects.toThrow('TEST abort');
  });

  it('preserves the exact store suffix rule', async () => {
    for (const suffix of ['v10', 'V10']) {
      const h = config10Fixture({
        npm_config_store_dir: `D:\\TEST\\s\\${suffix}`,
      });
      expect((await readPnpm10GlobalConfig(h.deps)).storeDir).toBe(
        win32.join('D:\\TEST\\s', suffix, ...(suffix === 'v10' ? [] : ['v10'])),
      );
    }
    const h = config10Fixture({ npm_config_store_dir: 'D:/TEST/s/v10' });
    expect((await readPnpm10GlobalConfig(h.deps)).storeDir).toBe(
      'D:\\TEST\\s\\v10\\v10',
    );
  });

  it('retains npm auth presence from environment without retaining its value', async () => {
    const h = config10Fixture({
      'npm_config_//registry.npmjs.org/:_authToken': 'TEST-env-token',
    });
    const config = await readPnpm10GlobalConfig(h.deps);
    expect(config.policy.publicAuthPresent).toBe(true);
    expect(JSON.stringify(config)).not.toContain('TEST-env-token');
  });

  it('rejects a source appearing after the negative observation', async () => {
    const h = config10Fixture();
    const file = `${P10.profile}\\.npmrc`;
    const original = h.lstat.getMockImplementation()!;
    let seen = 0;
    h.lstat.mockImplementation((p) => {
      if (p === file && ++seen === 2)
        h.put(file, { text: 'pnpmfile=evil.cjs' });
      return original(p);
    });
    await expectGlobalReason(
      () => readPnpm10GlobalConfig(h.deps),
      'CONFIG_UNSUPPORTED',
    );
  });

  // Node's Windows global lookup from <nodeDir>\lib\node tries lib\node\node_modules
  // and lib\node_modules before <nodeDir>\node_modules (pnpm.cjs:5544-5553).
  it('resolves builtin npm through lib\\node_modules before the Node directory', async () => {
    const h = config10Fixture();
    const lib = 'C:\\Program Files\\nodejs\\lib\\node_modules';
    h.put(`${lib}\\npm\\package.json`, {
      text: '{"name":"npm","main":"./index.js"}',
    });
    h.put(`${lib}\\npm\\index.js`, { text: '// TEST inert entry' });
    h.put(`${lib}\\npmrc`, {
      text: 'registry=https://registry.example.test/\n',
    });
    const c = await readPnpm10GlobalConfig(h.deps);
    expect(c.policy.defaultRegistry).toBe('custom');
    expect(c.configIdentities.map((i) => i.file.path)).toContain(
      `${lib}\\npmrc`,
    );
    expect(c.missingConfigPaths).toContain(
      'C:\\Program Files\\nodejs\\lib\\node\\node_modules\\npm',
    );
  });

  // config-chain ini.unsafe (pnpm.cjs:4600-4636): unquoted values stop at the
  // first unescaped ; or # and unescape \; \# \\, whatever precedes them.
  it.each([
    ['D:\\TEST\\g1#trailing comment', 'D:\\TEST\\g1'],
    ['D:\\TEST\\g2;comment', 'D:\\TEST\\g2'],
    ['D:\\TEST\\a\\#b', 'D:\\TEST\\a#b'],
    ['"D:\\\\TEST\\\\q"', 'D:\\TEST\\q'],
  ])('decodes INI value %s like pnpm', async (raw, expected) => {
    const h = config10Fixture();
    h.put(`${P10.profile}\\.npmrc`, { text: `global-dir=${raw}\n` });
    const c = await readPnpm10GlobalConfig(h.deps);
    expect(c.globalDir).toBe(expected);
  });

  it('refuses unknown builtin npm export resolution instead of using the app npm', async () => {
    const h = config10Fixture();
    h.put('C:\\Program Files\\nodejs\\node_modules\\npm\\package.json', {
      text: '{"name":"npm","main":"unknown.js","exports":"./unknown.js"}',
    });
    await expectGlobalReason(
      () => readPnpm10GlobalConfig(h.deps),
      'CONFIG_UNSUPPORTED',
    );
  });

  it.each(['file', 'node-addons'])(
    'refuses a shadowed builtin resolution (%s)',
    async (variant) => {
      const h = config10Fixture();
      if (variant === 'file')
        h.put('C:\\Program Files\\nodejs\\node_modules\\npm.js', {
          text: '// TEST shadows npm directory',
        });
      else
        h.put('C:\\Program Files\\nodejs\\node_modules\\npm\\package.json', {
          text: '{"name":"npm","main":"./index.js","exports":{"node-addons":"./other.js","default":"./index.js"}}',
        });
      await expectGlobalReason(
        () => readPnpm10GlobalConfig(h.deps),
        'CONFIG_UNSUPPORTED',
      );
    },
  );
});
