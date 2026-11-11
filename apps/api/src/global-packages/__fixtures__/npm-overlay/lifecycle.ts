import { win32 } from 'node:path';
import { testConfigIdentity, testRuntime } from '../global-lifecycle';
import { npmDiscoveryFixture } from './discovery';
import { NPM_SHIM_NAMES } from '../../interfaces/global-packages.runtime';
import { npm12Shims } from '../npm12/shims';

// TEST: memory-only runtime shared by service and HTTP integration tests.
export function npmLifecycleFixture(
  state: 'absent' | 'present' | 'broken' = 'absent',
) {
  const f = testRuntime();
  const memory = npmDiscoveryFixture(state === 'absent' ? null : 9);
  memory.put(memory.location.userConfig, { text: '' });
  memory.put(memory.location.globalConfig, { text: '' });
  memory.location.configIdentities = [
    testConfigIdentity(memory.location.userConfig),
    testConfigIdentity(memory.location.globalConfig),
  ];
  f.runtime.fs = memory.fs;
  f.runtime.nodeVersion = '24.19.0';
  const removeTree = (path: string) => {
    const key = win32.resolve(path).toLowerCase();
    for (const entry of memory.entries.keys())
      if (entry === key || entry.startsWith(`${key}\\`))
        memory.entries.delete(entry);
  };
  const absent = () => {
    removeTree(memory.overlay);
    for (const name of NPM_SHIM_NAMES)
      removeTree(win32.join(memory.location.binDir, name));
  };
  const present = (version = '12.2.2') => {
    memory.put(win32.join(memory.overlay, 'package.json'), {
      text: JSON.stringify({
        name: 'npm',
        version,
        bin: { npm: 'bin/npm-cli.js', npx: 'bin/npx-cli.js' },
      }),
    });
    for (const bin of ['npm', 'npx'])
      memory.put(win32.join(memory.overlay, 'bin', `${bin}-cli.js`), {
        text: 'TEST cli',
      });
    for (const name of NPM_SHIM_NAMES)
      memory.put(win32.join(memory.location.binDir, name), {
        text: npm12Shims(
          `node_modules/npm/bin/${name.startsWith('npx') ? 'npx' : 'npm'}-cli.js`,
        )[name.slice(3) as '' | '.cmd' | '.ps1'],
      });
  };
  if (state === 'broken')
    memory.remove(win32.join(memory.overlay, 'package.json'));
  const rm = jest
    .fn<
      Promise<void>,
      [string, { recursive: true; force: false; maxRetries: 0 }]
    >()
    .mockImplementation((path) => {
      removeTree(path);
      return Promise.resolve();
    });
  f.runtime.fs = Object.assign(memory.fs, { rm });
  return {
    ...f,
    memory,
    location: memory.location,
    rm,
    absent,
    present,
    removeTree,
  };
}
