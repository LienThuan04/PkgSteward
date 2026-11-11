import { createHash } from 'node:crypto';
import { win32 } from 'node:path';
import { AppException } from '@/common/exceptions/app.exception';
import type { IRunnerFs } from '@/npm-runner/interfaces/npm-runner.types';
import {
  readRunnerFile,
  runnerIdentity,
  sameRunnerIdentity,
} from '@/npm-runner/toolchain/runner-tool';
import {
  isProjectRecord,
  jsonDepthWithinLimit,
} from '@/projects/locks/project-lock-common';
import type {
  IGlobalPackageFacts,
  IGlobalResolvedLocation,
  INpmPathFacts,
  INpmSelfFacts,
  INpmShimFacts,
} from '../interfaces/global-packages.runtime';
import { NPM_SHIM_NAMES } from '../interfaces/global-packages.runtime';
import type {
  GlobalReasonCode,
  IGlobalNpmVersion,
} from '../interfaces/global-packages.types';
import {
  isGlobalAbsolutePath,
  isGlobalExactVersion,
} from '../execution/global-command';
import { normalizeGlobalBins } from '../policy/global-policy';
import {
  classifyNpmOverlay,
  npmDelegation,
  npmRetireCandidates,
  npmTerminalVersion,
} from '../policy/npm-overlay';
import { assertGlobalDirectory } from './global-location';

const SHIM_LIMIT = 64 * 1024;
const MANIFEST_LIMIT = 1024 * 1024;
const key = (path: string) => win32.resolve(path).toLowerCase();
const missing = (error: unknown) =>
  isProjectRecord(error) && error.code === 'ENOENT';
const failure = (reason: GlobalReasonCode = 'INVENTORY_FAILED') =>
  new AppException(409, 'Static npm facts are unavailable', 'CONFLICT', {
    reason,
  });
const digest = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');

export interface INpmSelfFactsInput {
  location: Pick<
    IGlobalResolvedLocation,
    'manager' | 'prefix' | 'globalRoot' | 'binDir' | 'tool' | 'protectedPaths'
  >;
  nodeVersion: string;
  signal: AbortSignal;
}

// Exact paths only. A physically present but unsafe entry remains a fact so the
// pure policy can distinguish broken, linked and unsupported layouts.
export async function readNpmSelfFacts(
  input: INpmSelfFactsInput,
  deps: { fs: IRunnerFs },
): Promise<INpmSelfFacts> {
  const { location, nodeVersion, signal } = input;
  const { fs } = deps;
  signal.throwIfAborted();
  if (
    location.manager !== 'npm' ||
    location.tool.manager !== 'npm' ||
    location.prefix === null ||
    !isGlobalAbsolutePath(location.prefix) ||
    !isGlobalAbsolutePath(location.globalRoot) ||
    !isGlobalAbsolutePath(location.binDir) ||
    key(location.globalRoot) !==
      key(win32.join(location.prefix, 'node_modules')) ||
    key(location.binDir) !== key(location.prefix)
  )
    throw failure('LOCATION_AMBIGUOUS');

  const pathFact = async (
    path: string,
    readText = false,
    maximum = SHIM_LIMIT,
  ): Promise<INpmPathFacts | null> => {
    signal.throwIfAborted();
    let stat: Awaited<ReturnType<IRunnerFs['lstat']>>;
    try {
      stat = await fs.lstat(path);
      signal.throwIfAborted();
    } catch (error) {
      signal.throwIfAborted();
      if (missing(error)) return null;
      throw error;
    }
    let realPath: string;
    try {
      realPath = await fs.realpath(path);
      signal.throwIfAborted();
    } catch (error) {
      signal.throwIfAborted();
      // A dangling reparse point still exists; do not dereference/read it.
      if (!stat.isSymbolicLink() || !missing(error)) throw error;
      realPath = path;
    }
    const entry: INpmPathFacts = {
      path,
      realPath,
      type: stat.isSymbolicLink()
        ? 'other'
        : stat.isDirectory?.()
          ? 'directory'
          : stat.isFile()
            ? 'file'
            : 'other',
      reparse: stat.isSymbolicLink(),
      identity: runnerIdentity(path, stat),
      text: null,
      sha256: null,
    };
    if (
      readText &&
      entry.type === 'file' &&
      !entry.reparse &&
      key(realPath) === key(path) &&
      Number.isSafeInteger(stat.size) &&
      stat.size >= 0 &&
      stat.size <= maximum
    ) {
      let data: Awaited<ReturnType<typeof readRunnerFile>>;
      try {
        data = await readRunnerFile(path, maximum, fs, signal, 'win32', {
          checkParent: () =>
            assertGlobalDirectory(win32.dirname(path), fs, signal),
        });
        signal.throwIfAborted();
      } catch (error) {
        signal.throwIfAborted();
        // Invalid UTF-8 or a newly oversized file is an unsafe physical entry.
        // Keep it unreadable for policy refusal; propagate I/O and race errors.
        if (
          error instanceof AppException &&
          (error.details as { reason?: string } | undefined)?.reason ===
            'CONFIG_UNSUPPORTED'
        )
          return entry;
        throw error;
      }
      signal.throwIfAborted();
      if (!data || !sameRunnerIdentity(entry.identity.stat, data.identity.stat))
        throw failure();
      entry.identity = data.identity;
      entry.text = data.text;
      entry.sha256 = digest(data.bytes);
    }
    return entry;
  };

  const manifestFacts = async (
    directory: INpmPathFacts,
  ): Promise<IGlobalPackageFacts | null> => {
    if (
      directory.reparse ||
      directory.type !== 'directory' ||
      key(directory.path) !== key(directory.realPath)
    )
      return null;
    const path = win32.join(directory.path, 'package.json');
    const manifest = await pathFact(path, true, MANIFEST_LIMIT);
    signal.throwIfAborted();
    if (!manifest || manifest.text === null || manifest.sha256 === null)
      return null;
    let raw: unknown;
    try {
      if (!jsonDepthWithinLimit(manifest.text)) return null;
      raw = JSON.parse(manifest.text);
    } catch {
      return null;
    }
    if (
      !isProjectRecord(raw) ||
      raw.name !== 'npm' ||
      typeof raw.version !== 'string' ||
      !isGlobalExactVersion(raw.version)
    )
      return null;
    let bins: IGlobalPackageFacts['bins'];
    try {
      bins = normalizeGlobalBins(raw.name, raw.bin);
    } catch {
      return null;
    }
    if (
      bins.length !== 2 ||
      !['npm', 'npx'].every((name) =>
        bins.some(
          (bin) => bin.name === name && bin.target === `bin/${name}-cli.js`,
        ),
      )
    )
      return null;
    const binIdentities: IGlobalPackageFacts['binIdentities'] = [];
    for (const bin of bins) {
      const target = win32.resolve(directory.path, bin.target);
      if (!key(target).startsWith(`${key(directory.path)}\\`)) return null;
      const parent = await pathFact(win32.dirname(target));
      signal.throwIfAborted();
      if (
        !parent ||
        parent.reparse ||
        parent.type !== 'directory' ||
        key(parent.realPath) !== key(parent.path)
      )
        return null;
      await assertGlobalDirectory(win32.dirname(target), fs, signal, true);
      signal.throwIfAborted();
      const entry = await pathFact(target);
      signal.throwIfAborted();
      if (
        !entry ||
        entry.reparse ||
        entry.type !== 'file' ||
        key(entry.realPath) !== key(target)
      )
        return null;
      binIdentities.push(entry.identity);
    }
    return {
      name: raw.name,
      version: raw.version,
      packageRoot: directory.path,
      manifest: { file: manifest.identity, sha256: manifest.sha256 },
      bins,
      binIdentities,
    };
  };

  try {
    const prefixResolved = win32.resolve(location.prefix);
    await assertGlobalDirectory(prefixResolved, fs, signal);
    signal.throwIfAborted();
    const prefixDirectory = await pathFact(prefixResolved);
    signal.throwIfAborted();
    if (!prefixDirectory) throw failure('LOCATION_AMBIGUOUS');
    const prefixReal = win32.resolve(prefixDirectory.realPath);
    const root = win32.join(prefixReal, 'node_modules');
    await assertGlobalDirectory(root, fs, signal);
    signal.throwIfAborted();
    const rootDirectory = await pathFact(root);
    signal.throwIfAborted();
    if (!rootDirectory) throw failure('LOCATION_AMBIGUOUS');
    const facts: INpmSelfFacts = {
      nodeVersion,
      nodeDir: win32.dirname(location.tool.file),
      packageDir: location.tool.packageDir,
      prefixResolved,
      prefixReal,
      protectedPaths: [...location.protectedPaths],
      prefixDirectory,
      rootDirectory,
      bundledVersion: location.tool.version,
      // Identity-only observations use an empty digest, never a fabricated hash.
      // Bundled tool content is revalidated by the caller's runner-tool boundary.
      bundledIdentities: location.tool.identities.map((file) => ({
        file: runnerIdentity(file.path, file.stat),
        sha256: '',
      })),
      nodeDirShims: [],
      prefixScript: null,
      overlay: null,
      shims: NPM_SHIM_NAMES.map((name) => ({ name, entry: null })),
      retired: [],
      repairTargets: [],
    };
    // Do not interpret the bundled package as a prefix overlay.
    if (classifyNpmOverlay(facts).state === 'unsupported') return facts;
    for (const name of NPM_SHIM_NAMES) {
      const entry = await pathFact(win32.join(facts.nodeDir, name), true);
      signal.throwIfAborted();
      facts.nodeDirShims.push({ name, entry });
    }
    const prefixScript = await pathFact(
      win32.join(facts.packageDir, 'bin', 'npm-prefix.js'),
    );
    signal.throwIfAborted();
    if (
      prefixScript &&
      !prefixScript.reparse &&
      prefixScript.type === 'file' &&
      key(prefixScript.realPath) === key(prefixScript.path)
    )
      facts.prefixScript = { file: prefixScript.identity, sha256: '' };

    const directory = await pathFact(win32.join(root, 'npm'));
    signal.throwIfAborted();
    if (directory) {
      const manifest = await manifestFacts(directory);
      signal.throwIfAborted();
      facts.overlay = { directory, package: manifest };
    }
    const shims: INpmShimFacts[] = [];
    for (const name of NPM_SHIM_NAMES) {
      const entry = await pathFact(win32.join(prefixReal, name), true);
      signal.throwIfAborted();
      shims.push({ name, entry });
    }
    facts.shims = shims;
    // Hash characters are case-sensitive even on a case-insensitive filesystem.
    // npmRetireCandidates already places every basename under the real folder.
    const candidates = new Set<string>();
    for (const relative of ['node_modules\\npm', ...NPM_SHIM_NAMES])
      for (const path of npmRetireCandidates(
        prefixResolved,
        prefixReal,
        relative,
      ))
        candidates.add(path);
    for (const path of candidates) {
      const entry = await pathFact(path, true);
      signal.throwIfAborted();
      if (entry) facts.retired.push(entry);
    }
    facts.repairTargets = classifyNpmOverlay(facts).repairTargets;
    return facts;
  } catch (error) {
    signal.throwIfAborted();
    if (
      error instanceof AppException &&
      (error.details as { reason?: string } | undefined)?.reason ===
        'LOCATION_AMBIGUOUS'
    )
      throw error;
    throw failure();
  }
}

export function summarizeNpmVersion(facts: INpmSelfFacts): IGlobalNpmVersion {
  const classification = classifyNpmOverlay(facts);
  const delegation = npmDelegation(facts);
  const terminalVersion = npmTerminalVersion(facts, classification.state);
  return {
    bundledVersion: facts.bundledVersion,
    overlayVersion: classification.state === 'absent' ? null : terminalVersion,
    terminalVersion,
    prefix: facts.prefixResolved,
    overlayState: classification.state,
    delegation,
    reason:
      classification.reason ??
      (delegation === 'unverified' ? 'NPM_DELEGATION_UNVERIFIED' : null),
  };
}
