import { win32 } from 'node:path';
import { memoryFs, testLocation } from '../global-adapters';
import { NPM_SHIM_NAMES } from '../../interfaces/global-packages.runtime';
import { NODE24_NODE_DIR_SHIMS } from './node-dir-shims';
import {
  CMD_SHIM8_PNPM_SHIMS,
  CMD_SHIM8_PNPM_TARGET,
} from './cmd-shim8-pnpm-shims';
import { npm12Shims } from '../npm12/shims';

// TEST không phải yêu cầu nghiệp vụ. In-memory files; no process or native fs.
export function npmDiscoveryFixture(present: 8 | 9 | null = null) {
  const memory = memoryFs();
  const location = testLocation();
  const nodeDir = win32.dirname(location.tool.file);
  const overlay = win32.join(location.globalRoot, 'npm');
  const prefixScript = win32.join(
    location.tool.packageDir,
    'bin',
    'npm-prefix.js',
  );
  memory.put(location.prefix!, { directory: true });
  memory.put(location.globalRoot, { directory: true });
  memory.put(prefixScript, { text: 'TEST identity only; never read/execute' });
  memory.put(location.tool.file, { text: 'TEST node' });
  for (const name of NPM_SHIM_NAMES)
    memory.put(win32.join(nodeDir, name), {
      text: NODE24_NODE_DIR_SHIMS[name],
    });
  if (present !== null) {
    memory.put(win32.join(overlay, 'package.json'), {
      text: JSON.stringify({
        name: 'npm',
        version: '12.2.2',
        bin: { npm: 'bin/npm-cli.js', npx: 'bin/npx-cli.js' },
      }),
    });
    for (const bin of ['npm', 'npx'])
      memory.put(win32.join(overlay, 'bin', `${bin}-cli.js`), {
        text: 'TEST cli',
      });
    for (const name of NPM_SHIM_NAMES) {
      const extension = name.slice(3) as '' | '.cmd' | '.ps1';
      const target = `node_modules/npm/bin/${name.startsWith('npx') ? 'npx' : 'npm'}-cli.js`;
      const text =
        present === 9
          ? npm12Shims(target)[extension]
          : CMD_SHIM8_PNPM_SHIMS[`pnpm${extension}`]
              .split(
                extension === '.cmd'
                  ? CMD_SHIM8_PNPM_TARGET.replace(/\//g, '\\')
                  : CMD_SHIM8_PNPM_TARGET,
              )
              .join(
                extension === '.cmd' ? target.replace(/\//g, '\\') : target,
              );
      memory.put(win32.join(location.binDir, name), { text });
    }
  }
  const remove = (path: string) =>
    memory.entries.delete(win32.resolve(path).toLowerCase());
  return { ...memory, location, nodeDir, overlay, prefixScript, remove };
}
