import { createHash } from 'node:crypto';
import { win32 } from 'node:path';
import type {
  IGlobalTargetFacts,
  INpmPathFacts,
  INpmSelfFacts,
} from '../../interfaces/global-packages.runtime';
import { NPM_SHIM_NAMES } from '../../interfaces/global-packages.runtime';
import { testConfigIdentity, testIdentity } from '../global-lifecycle';
import { NODE24_NODE_DIR_SHIMS } from './node-dir-shims';
import { npm12Shims } from '../npm12/shims';

// TEST không phải yêu cầu nghiệp vụ. No real filesystem/process operations.
export function npmEntry(
  path: string,
  type: INpmPathFacts['type'] = 'file',
  text = '',
): INpmPathFacts {
  const identity = testIdentity(path);
  identity.stat.size = Buffer.byteLength(text);
  identity.stat.isDirectory = () => type === 'directory';
  identity.stat.isFile = () => type === 'file';
  return {
    path,
    realPath: path,
    type,
    reparse: false,
    identity,
    text: type === 'file' ? text : null,
    sha256:
      type === 'file' ? createHash('sha256').update(text).digest('hex') : null,
  };
}
export function npmTarget(
  patch: Partial<IGlobalTargetFacts> = {},
): IGlobalTargetFacts {
  return {
    name: 'npm',
    version: '12.2.2',
    requestedVersion: 'latest',
    manifestHash: 'TEST-target',
    integrity: 'TEST-integrity',
    bins: [
      { name: 'npm', target: 'bin/npm-cli.js' },
      { name: 'npx', target: 'bin/npx-cli.js' },
    ],
    engines: '^22.22.2 || ^24.15.0 || >=26.0.0',
    deprecated: false,
    ...patch,
  };
}
export function npmSelfFacts(): INpmSelfFacts {
  return {
    nodeVersion: '24.19.0',
    nodeDir: 'C:\\Node',
    packageDir: 'C:\\Node\\node_modules\\npm',
    prefixResolved: 'D:\\TEST\\prefix',
    prefixReal: 'D:\\TEST\\prefix',
    protectedPaths: [],
    prefixDirectory: npmEntry('D:\\TEST\\prefix', 'directory'),
    rootDirectory: npmEntry('D:\\TEST\\prefix\\node_modules', 'directory'),
    bundledVersion: '11.17.0',
    bundledIdentities: [
      testConfigIdentity('C:\\Node\\node_modules\\npm\\package.json'),
    ],
    prefixScript: testConfigIdentity(
      'C:\\Node\\node_modules\\npm\\bin\\npm-prefix.js',
    ),
    nodeDirShims: NPM_SHIM_NAMES.map((name) => ({
      name,
      entry: npmEntry(
        win32.join('C:\\Node', name),
        'file',
        NODE24_NODE_DIR_SHIMS[name],
      ),
    })),
    overlay: null,
    shims: NPM_SHIM_NAMES.map((name) => ({ name, entry: null })),
    retired: [],
    repairTargets: [],
  };
}
export function npmPresent(version = '12.2.2'): INpmSelfFacts {
  const facts = npmSelfFacts();
  const root = win32.join(facts.prefixReal, 'node_modules', 'npm');
  facts.overlay = {
    directory: npmEntry(root, 'directory'),
    package: {
      name: 'npm',
      version,
      packageRoot: root,
      manifest: testConfigIdentity(win32.join(root, 'package.json')),
      bins: npmTarget().bins,
      binIdentities: [],
    },
  };
  facts.shims = NPM_SHIM_NAMES.map((name) => ({
    name,
    entry: npmEntry(
      win32.join(facts.prefixReal, name),
      'file',
      npm12Shims(
        `node_modules/npm/bin/${name.startsWith('npx') ? 'npx' : 'npm'}-cli.js`,
      )[name.slice(3) as '' | '.cmd' | '.ps1'],
    ),
  }));
  return facts;
}
