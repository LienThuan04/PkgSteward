import { win32 } from 'node:path';
import { config10Fixture, P10 } from './config';
import { f5bStep, F5B_MANIFESTS } from './facts';
import { F5B_SHIMS } from './shims';
import { testLocation, testSpawn } from '../global-adapters';
import { readPnpm10GlobalConfig } from '../../config/pnpm10-global-config';
import { parse, stringify } from 'yaml';

// TEST không phải yêu cầu nghiệp vụ. Memory-only project; junctions never
// delegate to a real filesystem, including the external link source.
export async function pnpm10InventoryFixture(step = 6) {
  const h = config10Fixture();
  const snapshot = f5bStep(step);
  for (const [relative, text] of Object.entries(snapshot.files))
    h.put(win32.join(P10.root, relative), { text });
  h.put(P10.store, { directory: true });
  // Retained versions accumulate; b9 intentionally retains all prior versions.
  const installed = new Map<string, string>();
  for (let n = 1; n <= step; n++)
    for (const [name, dep] of Object.entries(
      f5bStep(n).list[0].dependencies ?? {},
    )) {
      if (dep.version.startsWith('link:')) continue;
      installed.set(`${name}@${dep.version}`, dep.path);
    }
  if (step >= 4)
    installed.set(
      'is-number@6.0.0',
      `${P10.root}\\.pnpm\\is-number@6.0.0\\node_modules\\is-number`,
    );
  for (const [id, path] of installed) {
    h.put(path, { directory: true });
    h.put(`${path}\\package.json`, { text: F5B_MANIFESTS[id] });
    if (id.startsWith('semver@'))
      h.put(`${path}\\bin\\semver.js`, {
        text: '#!/usr/bin/env node\n// TEST inert semver bin',
      });
  }
  for (const [name, dep] of Object.entries(
    snapshot.list[0].dependencies ?? {},
  )) {
    h.put(win32.join(P10.root, 'node_modules', name), {
      link: true,
      real: dep.path,
    });
  }
  if (step >= 4)
    h.put(`${P10.root}\\.pnpm\\is-odd@3.0.1\\node_modules\\is-number`, {
      link: true,
      real: `${P10.root}\\.pnpm\\is-number@6.0.0\\node_modules\\is-number`,
    });
  for (const [name, family] of Object.entries(F5B_SHIMS)) {
    if (!snapshot.list[0].dependencies?.[name]) continue;
    for (const [ext, text] of Object.entries(family))
      h.put(`${P10.home}\\${name}${ext}`, { text });
  }
  if (step >= 6)
    for (const [name, family] of Object.entries(F5B_SHIMS)) {
      for (const [ext, text] of Object.entries(family))
        h.put(`${P10.root}\\node_modules\\.bin\\${name}${ext}`, {
          // Same pnpm.cjs generator; local .bin has a different relative operand.
          text: text
            .replaceAll('%~dp0\\global\\5\\.pnpm', '%~dp0\\..\\..\\.pnpm')
            .replaceAll('$basedir/global/5/.pnpm', '$basedir/../../.pnpm')
            .replaceAll(
              '%~dp0\\..\\linksrc',
              '%~dp0\\..\\..\\..\\..\\..\\linksrc',
            )
            .replaceAll(
              '$basedir/../linksrc',
              '$basedir/../../../../../linksrc',
            ),
        });
    }
  h.put(`${P10.home}\\foreign.txt`, { text: 'TEST reserved file' });
  // Enumerate actual memory entries, not a hardcoded result for the reader.
  h.readdir.mockImplementation((directory: string) =>
    Promise.resolve(
      [...h.entries.keys()]
        .filter(
          (path) =>
            win32.dirname(path).toLowerCase() === directory.toLowerCase() &&
            path !== directory.toLowerCase(),
        )
        .map((path) => win32.basename(path)),
    ),
  );
  const config = await readPnpm10GlobalConfig(h.deps);
  const location = {
    ...testLocation('pnpm', '10.34.9'),
    tool: h.deps.tool,
    globalRoot: P10.root,
    globalDir: config.globalDir,
    binDir: P10.home,
    storeDir: P10.store,
    userConfig: config.userConfig,
    globalConfig: config.globalConfig,
    cacheDir: config.cacheDir,
    configIdentities: [...config.configIdentities],
    pnpm10: config,
  };
  const spawn = testSpawn();
  const deps = {
    fs: h.fs,
    environment: h.environment,
    signal: h.controller.signal,
    spawn,
  };
  return { ...h, deps, location, snapshot, spawn };
}

export async function pnpm10BinlessFixture(
  version: '7.0.0' | '6.0.0' | null = '7.0.0',
  missingBin = true,
) {
  const h = await pnpm10InventoryFixture(
    version === null ? 9 : version === '7.0.0' ? 4 : 5,
  );
  const key = (p: string) => win32.resolve(p).toLowerCase();
  for (const relative of [
    'package.json',
    'pnpm-lock.yaml',
    'node_modules/.pnpm/lock.yaml',
  ]) {
    const file = win32.join(P10.root, relative),
      entry = h.entries.get(key(file));
    if (!entry?.text) continue;
    const data = parse(entry.text) as {
      dependencies?: Record<string, unknown>;
      importers?: Record<string, { dependencies?: Record<string, unknown> }>;
    };
    const dependencies =
      data.importers?.['.']?.dependencies ?? data.dependencies;
    for (const name of Object.keys(dependencies ?? {}))
      if (name !== 'is-number') {
        delete dependencies![name];
        h.entries.delete(key(win32.join(P10.root, 'node_modules', name)));
      }
    h.put(file, {
      text:
        relative === 'package.json' ? JSON.stringify(data) : stringify(data),
    });
  }
  const binDir = 'D:\\TEST\\separate-bin';
  h.put(binDir, { directory: true });
  h.environment.npm_config_global_bin_dir = binDir;
  h.environment.PATH = `${binDir};${win32.dirname(h.location.tool.file)}`;
  const config = await readPnpm10GlobalConfig({
    fs: h.fs,
    tool: h.location.tool,
    environment: h.environment,
    cwd: h.location.cwd,
    signal: h.controller.signal,
    checkDirectory: h.checkDirectory,
  });
  if (missingBin) h.entries.delete(key(binDir));
  h.location.binDir = binDir;
  h.location.configIdentities = [...config.configIdentities];
  h.location.pnpm10 = {
    ...config,
    directoryIdentities: config.directoryIdentities.filter(
      (d) => !missingBin || key(d.path) !== key(binDir),
    ),
    missingDirectoryPaths: [
      ...config.missingDirectoryPaths,
      ...(missingBin ? [binDir] : []),
    ],
  };
  return h;
}
