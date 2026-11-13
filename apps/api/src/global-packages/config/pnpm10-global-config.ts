import { win32 } from 'node:path';
import { createHash } from 'node:crypto';
import { AppException } from '@/common/exceptions/app.exception';
import type {
  IPnpmGlobalConfigDeps,
  IPnpmGlobalPolicy,
} from '../interfaces/pnpm-global.types';
import type { IPnpm10GlobalConfig } from '../interfaces/pnpm10-global.types';
import type { IGlobalConfigIdentity } from '../interfaces/global-packages.runtime';
import type {
  IRunnerFileIdentity,
  IRunnerFs,
} from '@/npm-runner/interfaces/npm-runner.types';
import {
  runnerIdentity,
  sameRunnerIdentity,
} from '@/npm-runner/toolchain/runner-tool';
import { isGlobalAbsolutePath } from '../execution/global-command';
import { isGlobalPackageName } from '../policy/global-policy';
import {
  GLOBAL_CONFIG_FILE_LIMIT,
  GLOBAL_CONFIG_TOTAL_LIMIT,
} from './global-config';

type ConfigReason =
  'CONFIG_UNSUPPORTED' | 'LIMIT_EXCEEDED' | 'PNPM_GLOBAL_NOT_CONFIGURED';
const refuse = (reason: ConfigReason = 'CONFIG_UNSUPPORTED'): never => {
  throw new AppException(
    409,
    'pnpm 10 configuration is unavailable',
    'CONFLICT',
    { reason },
  );
};
const key = (p: string): string => win32.resolve(p).toLowerCase();
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const dynamic = (v: string): boolean =>
  /\$\{|\$\(|`/.test(v) ||
  Array.from(v).some(
    (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
  );
const canonical = (s: string): string => s.replace(/[-_]/g, '').toLowerCase();
const absolute = (v: unknown): string => {
  if (typeof v !== 'string' || !isGlobalAbsolutePath(v) || dynamic(v))
    return refuse();
  return win32.normalize(v);
};
const absent = (e: unknown): boolean => record(e) && e.code === 'ENOENT';

// Shared by the inventory reader: JSON.parse alone silently discards duplicate keys.
export function parsePnpm10Json(text: string): unknown {
  const value: unknown = JSON.parse(text);
  const stack: (Set<string> | null)[] = [];
  for (const match of text.matchAll(/"(?:[^"\\]|\\[\s\S])*"|[{}[\]]/g)) {
    const token = match[0];
    if (token === '{' || token === '[') {
      stack.push(token === '{' ? new Set() : null);
      if (stack.length > 64) return refuse('LIMIT_EXCEEDED');
    } else if (token === '}' || token === ']') stack.pop();
    else if (
      text
        .slice(match.index + token.length)
        .trimStart()
        .startsWith(':')
    ) {
      const name: unknown = JSON.parse(token);
      const keys = stack.at(-1);
      if (
        typeof name !== 'string' ||
        !keys ||
        keys.has(name) ||
        ['__proto__', 'constructor', 'prototype'].includes(name)
      )
        return refuse();
      keys.add(name);
    }
  }
  return value;
}

// Handle-bound reads, explicit caps and parent checks before/after each read.
// Used by both adapters; callers retain only hashes/identities, never this text.
export async function readPnpm10File(
  path: string,
  maximum: number,
  fs: IRunnerFs,
  signal: AbortSignal,
  budget: { remaining: number },
  checkParent: () => Promise<void>,
  allowBinary = false,
): Promise<{ text: string; identity: IGlobalConfigIdentity } | null> {
  signal.throwIfAborted();
  await checkParent();
  signal.throwIfAborted();
  let identity: IRunnerFileIdentity;
  try {
    const stat = await fs.lstat(path);
    signal.throwIfAborted();
    identity = runnerIdentity(path, stat);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      !Number.isSafeInteger(stat.size) ||
      stat.size < 0
    )
      return refuse();
    if (stat.size > maximum || stat.size > budget.remaining)
      return refuse('LIMIT_EXCEEDED');
  } catch (error) {
    signal.throwIfAborted();
    if (absent(error)) return null;
    throw error;
  }
  if (key(await fs.realpath(path)) !== key(path)) return refuse();
  signal.throwIfAborted();
  const handle = await fs.open(path);
  try {
    signal.throwIfAborted();
    if (!sameRunnerIdentity(identity.stat, await handle.stat()))
      return refuse();
    signal.throwIfAborted();
    await checkParent();
    signal.throwIfAborted();
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of handle.readChunks(signal)) {
      signal.throwIfAborted();
      size += chunk.byteLength;
      budget.remaining -= chunk.byteLength;
      if (size > maximum || budget.remaining < 0)
        return refuse('LIMIT_EXCEEDED');
      chunks.push(Buffer.from(chunk));
    }
    signal.throwIfAborted();
    const afterHandle = await handle.stat();
    signal.throwIfAborted();
    const after = await fs.lstat(path);
    signal.throwIfAborted();
    const real = await fs.realpath(path);
    signal.throwIfAborted();
    await checkParent();
    signal.throwIfAborted();
    if (
      size !== identity.stat.size ||
      !sameRunnerIdentity(identity.stat, afterHandle) ||
      !sameRunnerIdentity(identity.stat, after) ||
      key(real) !== key(path)
    )
      return refuse();
    const bytes = Buffer.concat(chunks, size);
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      if (!allowBinary) return refuse();
      text = '';
    }
    // A foreign binary slot is pinned by identity/hash, with no executable text.
    return {
      text,
      identity: {
        file: identity,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    };
  } finally {
    await handle.close();
    signal.throwIfAborted();
  }
}

const versionedStore = (path: string): string =>
  path.endsWith('\\v10') ? path : win32.join(path, 'v10');
const pathKey = (name: string, value: string): string =>
  key(name === 'storedir' ? versionedStore(value) : value);

const paths = new Set([
  'globaldir',
  'globalbindir',
  'storedir',
  'cachedir',
  'statedir',
]);
const selectors = new Set([
  'pnpm_home',
  'xdg_data_home',
  'xdg_config_home',
  'xdg_cache_home',
  'xdg_state_home',
  'localappdata',
  'appdata',
  'userprofile',
  'home',
]);
const pathEnv = new Set(['userconfig', 'globalconfig', ...paths]);
const executable =
  /(?:pnpmfile|configdependencies|tokenhelper|onloadscript|nodeoptions|plugin|hooks)/;
const unsupported =
  /(?:build|built|minimumreleaseage|ignorescripts|ignoredepscripts|hoist|overrides|resolutions|packageextensions|peerdependencyrules|supportedarchitectures|catalog|patch|injectworkspacepackages|symlink|nodelinker|modulescachemaxage|lockfile|verifydepsbeforerun)/;
const unproven =
  /(?:dir|dirs|directory|directories|path|paths|file|files)$|workspace|shell|runtime|executionenv|usenodeversion|nodeversion|fetchers|resolvers/;
interface ISettings {
  paths: Map<string, string>;
  policy: IPnpmGlobalPolicy;
}
const settings = (): ISettings => ({
  paths: new Map(),
  policy: {
    defaultRegistry: null,
    scopedRegistries: [],
    unknownRouting: false,
    publicAuthPresent: false,
    changeUnsupported: false,
  },
});

function setting(
  source: ISettings,
  raw: string,
  value: unknown,
  env = false,
): void {
  const name = canonical(raw);
  const lower = raw.toLowerCase();
  if (executable.test(name)) return refuse();
  // Auth values may contain environment placeholders; only presence is retained.
  if (
    /^(?:\/\/.*:)?(?:_authtoken|_auth|_password|username|email|always-auth)$/i.test(
      raw,
    )
  ) {
    if (!lower.startsWith('//') || lower.startsWith('//registry.npmjs.org/:'))
      source.policy.publicAuthPresent = true;
    return;
  }
  if (dynamic(raw) || (typeof value === 'string' && dynamic(value)))
    return refuse();
  if (paths.has(name)) {
    const validated = absolute(value);
    const normalized = name === 'storedir' ? (value as string) : validated;
    if (
      source.paths.has(name) &&
      pathKey(name, source.paths.get(name)!) !== pathKey(name, normalized)
    )
      return refuse();
    source.paths.set(name, normalized);
    return;
  }
  if (['userconfig', 'globalconfig'].includes(name) && env) return;
  if (
    ['userconfig', 'globalconfig', 'prefix'].includes(name) ||
    unproven.test(name)
  )
    return refuse();
  if (name === 'registry') {
    const isPublic =
      value === 'https://registry.npmjs.org/' ||
      value === 'https://registry.npmjs.org';
    source.policy.defaultRegistry =
      isPublic && source.policy.defaultRegistry !== 'custom'
        ? 'public'
        : 'custom';
  } else if (/^@[^:]+:registry$/.test(lower)) {
    const scope = lower.slice(0, -9);
    if (!isGlobalPackageName(`${scope}/test`))
      source.policy.unknownRouting = true;
    source.policy.scopedRegistries = [
      ...new Set([...source.policy.scopedRegistries, scope]),
    ].sort();
  } else if (name.includes('registr')) source.policy.unknownRouting = true;
  else if (unsupported.test(name)) source.policy.changeUnsupported = true;
}

// pnpm.cjs:4600-4636 (config-chain ini.unsafe). Quoted values go through
// JSON.parse when valid; unquoted values unescape \\ \; \# and stop at the
// first unescaped ; or #, wherever it appears.
function iniValue(raw: string): unknown {
  const value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    const inner = value.startsWith("'") ? value.slice(1, -1) : value;
    try {
      return JSON.parse(inner) as unknown;
    } catch {
      return inner;
    }
  }
  let escaped = false;
  let result = '';
  for (const char of value) {
    if (escaped) {
      result += '\\;#'.includes(char) ? char : `\\${char}`;
      escaped = false;
    } else if (char === ';' || char === '#') break;
    else if (char === '\\') escaped = true;
    else result += char;
  }
  if (escaped) result += '\\';
  return result.trim();
}

function ini(text: string): ISettings {
  const result = settings();
  const seen = new Map<string, string>();
  // pnpm.cjs:5255-5266,5539-5578 consumes npm INI. Only the inert flat subset
  // is supported; reject sections/ambiguous decoding instead of guessing.
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^[#;]/.test(trimmed)) continue;
    const match = /^([^=]+)=(.*)$/.exec(trimmed);
    if (!match || trimmed.startsWith('[')) return refuse();
    let raw = match[1].trim();
    if (/^["']/.test(raw)) {
      if (!raw.endsWith(raw[0])) return refuse();
      raw = raw.slice(1, -1);
    }
    if (/[\\#;]/.test(raw)) return refuse();
    if (raw.endsWith('[]')) {
      const normalized = canonical(raw.slice(0, -2));
      if (paths.has(normalized) || executable.test(normalized)) return refuse();
      result.policy.changeUnsupported = true;
      continue;
    }
    const value = iniValue(match[2]);
    const normalized = canonical(raw);
    const fingerprint = createHash('sha256')
      .update(typeof value === 'string' ? value : JSON.stringify(value))
      .digest('hex');
    if (seen.has(normalized) && seen.get(normalized) !== fingerprint)
      return refuse();
    seen.set(normalized, fingerprint);
    setting(result, raw, value);
  }
  return result;
}

function combine(target: ISettings, source: ISettings): void {
  for (const [name, value] of source.paths) {
    // Safety restriction: refuse conflicting path selectors across layers. Do
    // not claim a path that a lower-priority source will select on another verb.
    if (
      target.paths.has(name) &&
      pathKey(name, target.paths.get(name)!) !== pathKey(name, value)
    )
      return refuse();
    target.paths.set(name, value);
  }
  const a = target.policy,
    b = source.policy;
  a.defaultRegistry =
    a.defaultRegistry === 'custom' || b.defaultRegistry === 'custom'
      ? 'custom'
      : (a.defaultRegistry ?? b.defaultRegistry);
  a.scopedRegistries = [
    ...new Set([...a.scopedRegistries, ...b.scopedRegistries]),
  ].sort();
  a.publicAuthPresent ||= b.publicAuthPresent;
  a.unknownRouting ||= b.unknownRouting;
  a.changeUnsupported ||= b.changeUnsupported;
}

export async function readPnpm10GlobalConfig(
  deps: IPnpmGlobalConfigDeps,
): Promise<IPnpm10GlobalConfig> {
  const { fs, signal, environment: environment } = deps;
  signal.throwIfAborted();
  try {
    let bytes = 0;
    const selected: Record<string, string> = {};
    const envSettings = settings();
    const envSeen = new Map<string, string>();
    let path = '';
    for (const [raw, value] of Object.entries(environment)) {
      if (value === undefined) continue;
      bytes += Buffer.byteLength(raw) + Buffer.byteLength(value);
      if (bytes > GLOBAL_CONFIG_TOTAL_LIMIT) return refuse('LIMIT_EXCEEDED');
      const lower = raw.toLowerCase();
      if (lower === 'path') {
        if (envSeen.has(lower) && path !== value) return refuse();
        path = value;
        envSeen.set(lower, value);
        continue;
      }
      if (selectors.has(lower)) {
        if (!value) continue;
        const normalized = absolute(value);
        if (selected[lower] && key(selected[lower]) !== key(normalized))
          return refuse();
        selected[lower] = normalized;
        continue;
      }
      if (lower === 'npm_token' || lower === 'node_auth_token')
        envSettings.policy.publicAuthPresent = true;
      // pnpm.cjs:5255-5266 ignores empty npm env and all pnpm_config_*.
      if (!lower.startsWith('npm_config_') || !value) continue;
      // pnpm.cjs:4886-4902 preserves the first underscore (auth keys),
      // including the first character after a scope/URL colon.
      const option = lower
        .slice(11)
        .replace(
          /(^|:)([^:]+)/g,
          (_match, prefix: string, part: string) =>
            prefix + part[0] + part.slice(1).replace(/_/g, '-'),
        );
      const normalized = canonical(option);
      const fingerprint = createHash('sha256').update(value).digest('hex');
      if (envSeen.has(normalized) && envSeen.get(normalized) !== fingerprint)
        return refuse();
      envSeen.set(normalized, fingerprint);
      if (pathEnv.has(normalized))
        selected[`npm_config_${normalized}`] = absolute(value);
      // --dir W supplies the prefix regardless of inherited npm prefix.
      if (normalized === 'prefix') {
        absolute(value);
        continue;
      }
      if (
        [
          'useragent',
          'localprefix',
          'globalprefix',
          'npmversion',
          'nodegyp',
          'initmodule',
        ].includes(normalized)
      )
        continue;
      // Unlike pnpm 11 this key is consumed, but the command adapter pins false.
      if (normalized === 'managepackagemanagerversions') continue;
      setting(envSettings, option, value, true);
    }
    const profile = selected.userprofile ?? selected.home;
    if (!profile) return refuse();
    // pnpm.cjs:17160-17218: independent XDG/Windows selectors.
    const local = selected.localappdata;
    const homeDir =
      selected.pnpm_home ??
      (selected.xdg_data_home
        ? win32.join(selected.xdg_data_home, 'pnpm')
        : local
          ? win32.join(local, 'pnpm')
          : win32.join(profile, '.pnpm'));
    const configDir = selected.xdg_config_home
      ? win32.join(selected.xdg_config_home, 'pnpm')
      : local
        ? win32.join(local, 'pnpm', 'config')
        : win32.join(profile, '.config', 'pnpm');
    const userConfig =
      selected.npm_config_userconfig ?? win32.join(profile, '.npmrc');
    // pnpm.cjs:18887-18889,5557-5565: --dir W temporarily sets prefix=W.
    const globalConfig =
      selected.npm_config_globalconfig ??
      win32.join(absolute(deps.cwd), 'etc', 'npmrc');
    const configIdentities: IGlobalConfigIdentity[] = [];
    const missingConfigPaths: string[] = [];
    const budget = { remaining: GLOBAL_CONFIG_TOTAL_LIMIT - bytes };
    const read = new Map<string, string | null>();
    const source = async (file: string): Promise<string | null> => {
      if (read.has(key(file))) return read.get(key(file))!;
      const data = await readPnpm10File(
        file,
        GLOBAL_CONFIG_FILE_LIMIT,
        fs,
        signal,
        budget,
        () => deps.checkDirectory(win32.dirname(file)),
      );
      if (data) configIdentities.push(data.identity);
      else missingConfigPaths.push(file);
      read.set(key(file), data?.text ?? null);
      return data?.text ?? null;
    };
    // pnpm.cjs:5544-5553: resolve npm from the final Windows global lookup
    // path, not the app's chosen npm. Support inert, ordinary npm packages;
    // unknown export/main resolution is refused rather than loading JS.
    // That path is <nodeDir>\lib\node: Node tries its node_modules ancestors
    // (lib\node\node_modules, lib\node_modules, <nodeDir>\node_modules, ...),
    // then the home globals and lib\node itself.
    let builtin: string | null = null;
    const nodeDir = win32.dirname(absolute(deps.tool.file));
    const lookupBase = win32.join(nodeDir, 'lib', 'node');
    const candidates: string[] = [];
    let ancestor = lookupBase;
    while (true) {
      if (win32.basename(ancestor).toLowerCase() !== 'node_modules')
        candidates.push(win32.join(ancestor, 'node_modules', 'npm'));
      const parent = win32.dirname(ancestor);
      if (parent === ancestor) break;
      ancestor = parent;
    }
    candidates.push(
      win32.join(profile, '.node_modules', 'npm'),
      win32.join(profile, '.node_libraries', 'npm'),
      win32.join(lookupBase, 'npm'),
    );
    for (const npm of candidates) {
      // CommonJS tries files before package directories. A sibling npm.js,
      // npm.json or native npm.node changes the builtin source resolution.
      for (const extension of ['.js', '.json', '.node']) {
        const path = `${npm}${extension}`;
        await deps.checkDirectory(win32.dirname(path));
        signal.throwIfAborted();
        try {
          await fs.lstat(path);
          signal.throwIfAborted();
        } catch (error) {
          signal.throwIfAborted();
          if (absent(error)) {
            missingConfigPaths.push(path);
            continue;
          }
          throw error;
        }
        return refuse();
      }
      try {
        const stat = await fs.lstat(npm);
        signal.throwIfAborted();
        if (!stat.isDirectory?.() || stat.isSymbolicLink()) return refuse();
      } catch (error) {
        signal.throwIfAborted();
        if (!absent(error)) throw error;
        missingConfigPaths.push(npm);
      }
      const manifestText = await source(win32.join(npm, 'package.json'));
      if (manifestText === null) {
        // A directory without a manifest can resolve index.js, so pin/refuse it.
        for (const file of ['index.js', 'index.json', 'index.node']) {
          const index = await source(win32.join(npm, file));
          if (index !== null) return refuse();
        }
        continue;
      }
      const manifest = parsePnpm10Json(manifestText);
      if (!record(manifest) || manifest.name !== 'npm') return refuse();
      const main = manifest.main ?? 'index.js';
      if (
        typeof main !== 'string' ||
        !/^(?:\.\/)?(?:index\.js|bin\/npm-cli\.js)$/.test(main)
      )
        return refuse();
      if (manifest.exports !== undefined) {
        const resolveExport = (v: unknown, depth: number): string | null => {
          if (depth > 8) return null;
          if (typeof v === 'string') return v;
          if (Array.isArray(v)) return resolveExport(v[0], depth + 1);
          if (record(v)) {
            const names = Object.keys(v);
            if (
              names.includes('node-addons') ||
              names.some((name) => /^\d+$/.test(name))
            )
              return null;
            const first = names.find((name) =>
              ['.', 'node', 'require', 'default'].includes(name),
            );
            return first ? resolveExport(v[first], depth + 1) : null;
          }
          return null;
        };
        if (
          resolveExport(manifest.exports, 0)?.replace(/^\.\//, '') !==
          main.replace(/^\.\//, '')
        )
          return refuse();
      }
      const entry = win32.join(npm, main);
      if ((await source(entry)) === null) return refuse();
      builtin = win32.resolve(win32.dirname(entry), '..', 'npmrc');
      break;
    }
    const effective = settings();
    for (const file of [
      userConfig,
      globalConfig,
      ...(builtin ? [builtin] : []),
      win32.join(configDir, 'rc'),
      win32.join(deps.tool.packageDir, 'dist', 'pnpmrc'),
    ]) {
      const text = await source(file);
      if (text !== null) combine(effective, ini(text));
    }
    combine(effective, envSettings);
    const globalDir =
      effective.paths.get('globaldir') ?? win32.join(homeDir, 'global');
    const globalRoot = win32.join(globalDir, '5');
    // pnpm.cjs:19058-19072: computed H is not a fallback for missing PNPM_HOME.
    const binDir = effective.paths.get('globalbindir') ?? selected.pnpm_home;
    if (!binDir) return refuse('PNPM_GLOBAL_NOT_CONFIGURED');
    const originalPath = path.split(';').filter((p) => isGlobalAbsolutePath(p));
    if (!originalPath.some((p) => key(p) === key(binDir)))
      return refuse('PNPM_GLOBAL_NOT_CONFIGURED');
    const storeBase = effective.paths.get('storedir');
    // pnpm.cjs:49009-49049 tests the literal suffix before joining.
    const storeDir = storeBase
      ? storeBase.endsWith('\\v10')
        ? storeBase
        : win32.join(storeBase, 'v10')
      : null;
    const cacheDir =
      effective.paths.get('cachedir') ??
      (selected.xdg_cache_home
        ? win32.join(selected.xdg_cache_home, 'pnpm')
        : local
          ? win32.join(local, 'pnpm-cache')
          : win32.join(profile, '.pnpm-cache'));
    const stateDir =
      effective.paths.get('statedir') ??
      (selected.xdg_state_home
        ? win32.join(selected.xdg_state_home, 'pnpm')
        : local
          ? win32.join(local, 'pnpm-state')
          : win32.join(profile, '.pnpm-state'));
    const projectText = await source(win32.join(globalRoot, 'package.json'));
    if (projectText !== null) {
      const project = parsePnpm10Json(projectText);
      if (!record(project)) return refuse();
      // pnpm.cjs:18289-18324 consumes root pnpm options + Yarn resolutions.
      if (project.pnpm !== undefined) {
        if (!record(project.pnpm)) return refuse();
        for (const [name, value] of Object.entries(project.pnpm))
          setting(effective, name, value);
      }
      if (project.resolutions !== undefined)
        effective.policy.changeUnsupported = true;
    }
    // pnpm.cjs:126560-126589: default hook is executable even without rc.
    for (const directory of [globalRoot, deps.cwd]) {
      if ((await source(win32.join(directory, '.pnpmfile.cjs'))) !== null)
        return refuse();
    }
    const directoryIdentities: IRunnerFileIdentity[] = [];
    const missingDirectoryPaths: string[] = [];
    for (const directory of [
      ...new Set([
        binDir,
        homeDir,
        globalDir,
        globalRoot,
        configDir,
        cacheDir,
        stateDir,
        deps.cwd,
        ...(storeDir ? [storeDir] : []),
      ]),
    ]) {
      await deps.checkDirectory(directory);
      signal.throwIfAborted();
      try {
        const stat = await fs.lstat(directory);
        signal.throwIfAborted();
        if (
          !stat.isDirectory?.() ||
          stat.isSymbolicLink() ||
          key(await fs.realpath(directory)) !== key(directory)
        )
          return refuse();
        signal.throwIfAborted();
        directoryIdentities.push(runnerIdentity(directory, stat));
      } catch (error) {
        signal.throwIfAborted();
        if (!absent(error)) throw error;
        if (key(directory) === key(binDir))
          return refuse('PNPM_GLOBAL_NOT_CONFIGURED');
        missingDirectoryPaths.push(directory);
      }
    }
    for (const file of configIdentities) {
      await deps.checkDirectory(win32.dirname(file.file.path));
      signal.throwIfAborted();
      const stat = await fs.lstat(file.file.path);
      signal.throwIfAborted();
      if (
        !sameRunnerIdentity(file.file.stat, stat) ||
        key(await fs.realpath(file.file.path)) !== key(file.file.path)
      )
        return refuse();
      signal.throwIfAborted();
    }
    for (const path of [...missingConfigPaths, ...missingDirectoryPaths]) {
      try {
        await fs.lstat(path);
        signal.throwIfAborted();
      } catch (error) {
        signal.throwIfAborted();
        if (absent(error)) continue;
        throw error;
      }
      return refuse();
    }
    signal.throwIfAborted();
    return {
      homeDir,
      globalDir,
      globalRoot,
      binDir,
      storeDir,
      cacheDir,
      stateDir,
      configDir,
      userConfig,
      globalConfig,
      originalPath,
      selectors: selected,
      policy: effective.policy,
      configIdentities,
      missingConfigPaths,
      directoryIdentities,
      missingDirectoryPaths,
    };
  } catch (error) {
    signal.throwIfAborted();
    if (
      error instanceof AppException &&
      record(error.details) &&
      [
        'CONFIG_UNSUPPORTED',
        'LIMIT_EXCEEDED',
        'PNPM_GLOBAL_NOT_CONFIGURED',
      ].includes(String(error.details.reason))
    )
      throw error;
    return refuse();
  }
}
