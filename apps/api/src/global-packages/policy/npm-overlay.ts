import { createHash } from 'node:crypto';
import { win32 } from 'node:path';
import * as semver from 'semver';
import { AppException } from '@/common/exceptions/app.exception';
import { NPM_SHIM_NAMES } from '@/global-packages/interfaces/global-packages.runtime';
import type {
  IGlobalTargetFacts,
  INpmPathFacts,
  INpmSelfFacts,
  INpmShimFacts,
} from '@/global-packages/interfaces/global-packages.runtime';
import type {
  GlobalAction,
  GlobalReasonCode,
  GlobalWarningCode,
  IGlobalBin,
  IGlobalNpmVersion,
} from '@/global-packages/interfaces/global-packages.types';
import {
  NODE24_NODE_DIR_SHIMS,
  NODE_DIR_SHIM_SETS,
  CMD_SHIM8_PNPM_SHIMS,
  CMD_SHIM8_PNPM_TARGET,
  npm12Shims,
} from '@/global-packages/policy/npm-shim-shapes';

const refuse = (reason: GlobalReasonCode): never => {
  throw new AppException(
    409,
    'npm overlay policy refused the operation',
    'CONFLICT',
    { reason },
  );
};
const exact = (version: string): semver.SemVer | null => {
  if (typeof version !== 'string') return null;
  const parsed = semver.parse(version);
  // npm releases never carry build metadata; a "+build" target is not a supported release.
  return parsed && version === parsed.version ? parsed : null;
};
const npmBins = (bins: readonly IGlobalBin[]): boolean =>
  bins.length === 2 &&
  ['npm', 'npx'].every((name) =>
    bins.some(
      (bin) => bin.name === name && bin.target === `bin/${name}-cli.js`,
    ),
  );

export function assertNpmTarget(
  target: IGlobalTargetFacts,
  nodeVersion: string,
  terminalVersion: string | null,
): void {
  const parsed = exact(target.version);
  if (
    target.name !== 'npm' ||
    !parsed ||
    ![10, 11, 12].includes(parsed.major) ||
    parsed.prerelease.length ||
    target.deprecated !== false ||
    !npmBins(target.bins)
  )
    refuse('TARGET_VERSION_UNSUPPORTED');
  if (
    typeof target.engines !== 'string' ||
    !target.engines.trim() ||
    !semver.validRange(target.engines) ||
    !semver.valid(nodeVersion) ||
    !semver.satisfies(nodeVersion, target.engines)
  )
    refuse('ENGINE_UNSUPPORTED');
  if (terminalVersion !== null && semver.eq(target.version, terminalVersion))
    refuse('NO_VERSION_CHANGE');
}

const key = (path: string): string => win32.resolve(path).toLowerCase();
const inside = (child: string, parent: string): boolean => {
  const relative = win32.relative(key(parent), key(child));
  return (
    relative === '' ||
    (!relative.startsWith('..\\') &&
      relative !== '..' &&
      !win32.isAbsolute(relative))
  );
};
const overlaps = (a: string, b: string): boolean =>
  inside(a, b) || inside(b, a);

export function npmRetirePath(path: string): string {
  const hash = createHash('sha1')
    .update(path)
    .digest('base64')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .slice(0, 8);
  return win32.resolve(win32.dirname(path), `.${win32.basename(path)}-${hash}`);
}
/**
 * Exact renamed paths arborist may leave for `relative` under the prefix. npm hashes the
 * prefix string it was given (case-sensitive), but the rename happens in the real folder,
 * so every hash input's basename is placed under `prefixReal`.
 */
export function npmRetireCandidates(
  prefixResolved: string,
  prefixReal: string,
  relative: string,
): string[] {
  const inputs = [prefixResolved, prefixReal].flatMap((prefix) => {
    const path = win32.resolve(prefix, relative);
    return /^[a-z]:/i.test(path)
      ? [
          path[0].toUpperCase() + path.slice(1),
          path[0].toLowerCase() + path.slice(1),
        ]
      : [path];
  });
  const folder = win32.dirname(win32.resolve(prefixReal, relative));
  return [
    ...new Set(
      inputs.map((input) =>
        win32.join(folder, win32.basename(npmRetirePath(input))),
      ),
    ),
  ];
}
// Folder compared case-insensitively (NTFS), retired basename exactly (its hash is case-sensitive).
const retiredKey = (path: string): string =>
  `${key(win32.dirname(path))}\\${win32.basename(path)}`;

export function proveNpmShim(
  name: string,
  text: string,
): 'proven' | 'empty' | 'foreign' {
  if (!NPM_SHIM_NAMES.some((member) => member === name)) return 'foreign';
  if (text === '') return 'empty';
  const bin = name.startsWith('npx') ? 'npx' : 'npm';
  const extension = name.slice(3) as '' | '.cmd' | '.ps1';
  const target = `node_modules/npm/bin/${bin}-cli.js`;
  const original =
    extension === '.cmd'
      ? CMD_SHIM8_PNPM_TARGET.replace(/\//g, '\\')
      : CMD_SHIM8_PNPM_TARGET;
  const replacement =
    extension === '.cmd' ? target.replace(/\//g, '\\') : target;
  const shim8 = CMD_SHIM8_PNPM_SHIMS[`pnpm${extension}`]
    .split(original)
    .join(replacement);
  return text === shim8 || text === npm12Shims(target)[extension]
    ? 'proven'
    : 'foreign';
}
export function proveNodeDirShim(
  name: string,
  text: string,
  shims: Readonly<Record<string, string>> = NODE24_NODE_DIR_SHIMS,
): 'verified' | 'unverified' {
  return Object.hasOwn(shims, name) && shims[name] === text
    ? 'verified'
    : 'unverified';
}

export interface INpmOverlayClassification {
  state: IGlobalNpmVersion['overlayState'];
  reason: GlobalReasonCode | null;
  repairReason: GlobalReasonCode | null;
  repairTargets: INpmPathFacts[];
}
const safeEntry = (
  entry: INpmPathFacts,
  type: INpmPathFacts['type'],
): GlobalReasonCode | null => {
  if (entry.reparse || key(entry.realPath) !== key(entry.path))
    return 'LINKED_PACKAGE';
  if (entry.type !== type || key(entry.identity.path) !== key(entry.path))
    return 'BIN_CONFLICT';
  if (
    entry.identity.stat.dev === undefined ||
    entry.identity.stat.ino === undefined
  )
    return 'BIN_CONFLICT';
  if (
    type === 'file' &&
    (entry.identity.stat.size > 65536 ||
      entry.identity.stat.size < 0 ||
      entry.sha256 === null ||
      entry.text === null ||
      Buffer.byteLength(entry.text) !== entry.identity.stat.size)
  )
    return 'BIN_CONFLICT';
  return null;
};
const completeShims = (shims: readonly INpmShimFacts[]): boolean =>
  shims.length === NPM_SHIM_NAMES.length &&
  NPM_SHIM_NAMES.every(
    (name) => shims.filter((shim) => shim.name === name).length === 1,
  );

export function npmDelegation(facts: INpmSelfFacts): 'verified' | 'unverified' {
  return facts.prefixScript !== null &&
    key(facts.prefixScript.file.path) ===
      key(win32.join(facts.packageDir, 'bin', 'npm-prefix.js')) &&
    completeShims(facts.nodeDirShims) &&
    // All six shims must come from one known Node build; mixing sets is refused.
    NODE_DIR_SHIM_SETS.some((shims) =>
      facts.nodeDirShims.every(
        ({ name, entry }) =>
          entry !== null &&
          key(entry.path) === key(win32.join(facts.nodeDir, name)) &&
          safeEntry(entry, 'file') === null &&
          proveNodeDirShim(name, entry.text!, shims) === 'verified',
      ),
    )
    ? 'verified'
    : 'unverified';
}

export function classifyNpmOverlay(
  facts: INpmSelfFacts,
): INpmOverlayClassification {
  const result = (
    state: INpmOverlayClassification['state'],
    reason: GlobalReasonCode | null,
    repairReason: GlobalReasonCode | null = reason,
    repairTargets: INpmPathFacts[] = [],
  ): INpmOverlayClassification => ({
    state,
    reason,
    repairReason,
    repairTargets,
  });
  const roots = [facts.nodeDir, facts.packageDir];
  if (
    [facts.prefixReal, facts.overlay?.directory.realPath].some(
      (path) =>
        path !== undefined && roots.some((root) => overlaps(path, root)),
    )
  )
    return result('unsupported', 'NPM_PREFIX_IS_NODE_DIR');
  // Paths an install would write: protected trees refuse every action, even with no overlay yet.
  const written = [
    win32.join(facts.prefixReal, 'node_modules', 'npm'),
    ...NPM_SHIM_NAMES.map((name) => win32.join(facts.prefixReal, name)),
  ];
  if (
    written.some((path) =>
      facts.protectedPaths.some((root) => overlaps(path, root)),
    )
  )
    return result('unsupported', 'PROTECTED_PACKAGE');
  if (facts.overlay?.directory.reparse)
    return result('linked', 'LINKED_PACKAGE');
  if (!completeShims(facts.shims)) return result('broken', 'BIN_CONFLICT');
  for (const [entry, path] of [
    [facts.prefixDirectory, facts.prefixReal],
    [facts.rootDirectory, win32.join(facts.prefixReal, 'node_modules')],
  ] as const) {
    const failure = safeEntry(entry, 'directory');
    if (failure || key(entry.path) !== key(path))
      return result('broken', failure ?? 'BIN_CONFLICT');
  }
  const candidates = new Map<string, INpmPathFacts['type']>();
  for (const relative of ['node_modules\\npm', ...NPM_SHIM_NAMES])
    for (const path of npmRetireCandidates(
      facts.prefixResolved,
      facts.prefixReal,
      relative,
    ))
      candidates.set(
        retiredKey(path),
        relative === 'node_modules\\npm' ? 'directory' : 'file',
      );
  const targets: INpmPathFacts[] = [];
  let allProven = true;
  for (const name of NPM_SHIM_NAMES) {
    const entry = facts.shims.find((shim) => shim.name === name)!.entry;
    if (entry === null) {
      allProven = false;
      continue;
    }
    const failure = safeEntry(entry, 'file');
    if (failure || key(entry.path) !== key(win32.join(facts.prefixReal, name)))
      return result('broken', failure ?? 'BIN_CONFLICT');
    const proof = proveNpmShim(name, entry.text!);
    if (proof === 'foreign') return result('broken', 'BIN_CONFLICT');
    if (proof !== 'proven') allProven = false;
    targets.push(entry);
  }
  if (facts.overlay) {
    const entry = facts.overlay.directory;
    const failure = safeEntry(entry, 'directory');
    if (
      failure ||
      key(entry.path) !==
        key(win32.join(facts.prefixReal, 'node_modules', 'npm'))
    )
      return result('broken', failure ?? 'BIN_CONFLICT');
    targets.push(entry);
  }
  for (const entry of facts.retired) {
    const type = candidates.get(retiredKey(entry.path));
    if (!type) return result('broken', 'BIN_CONFLICT');
    const failure = safeEntry(entry, type);
    // Retired shim contents may be truncated by npm's interrupted rename/copy.
    // Exact retired path, file identity and digest authorize deletion, not text proof.
    if (failure) return result('broken', failure);
    targets.push(entry);
  }
  for (const entry of targets) {
    if (
      !inside(entry.realPath, facts.prefixReal) ||
      key(entry.realPath) === key(facts.prefixReal) ||
      [...roots, ...facts.protectedPaths].some((root) =>
        overlaps(entry.realPath, root),
      )
    )
      return result('broken', 'BIN_CONFLICT');
  }
  if (!facts.overlay && targets.length === 0)
    return result('absent', null, null);
  const manifest = facts.overlay?.package;
  const validManifest =
    manifest &&
    manifest.name === 'npm' &&
    exact(manifest.version) &&
    npmBins(manifest.bins) &&
    key(manifest.packageRoot) === key(facts.overlay!.directory.path);
  if (validManifest && allProven && facts.retired.length === 0)
    return result('present', null, null);
  return result('broken', 'INVENTORY_FAILED', null, [
    ...new Map(targets.map((entry) => [key(entry.path), entry])).values(),
  ]);
}

export function npmTerminalVersion(
  facts: INpmSelfFacts,
  state = classifyNpmOverlay(facts).state,
): string | null {
  if (state === 'absent') return facts.bundledVersion;
  const manifest = facts.overlay?.package;
  return (state === 'present' || state === 'broken') &&
    manifest?.name === 'npm' &&
    exact(manifest.version)
    ? manifest.version
    : null;
}
export function assertNpmOverlayMutable(
  action: GlobalAction,
  facts: INpmSelfFacts,
): INpmOverlayClassification {
  const classification = classifyNpmOverlay(facts);
  if (
    classification.state === 'unsupported' ||
    classification.state === 'linked'
  )
    refuse(classification.reason!);
  if (action === 'repair') {
    if (classification.state !== 'broken') refuse('NPM_OVERLAY_NOT_BROKEN');
    if (classification.repairReason) refuse(classification.repairReason);
  } else {
    if (classification.state === 'broken')
      refuse(classification.reason ?? 'INVENTORY_FAILED');
    if (action === 'remove' && classification.state === 'absent')
      refuse('NPM_OVERLAY_ABSENT');
    if (action === 'change' && npmDelegation(facts) !== 'verified')
      refuse('NPM_DELEGATION_UNVERIFIED');
  }
  return classification;
}
export function npmSelfWarnings(
  action: GlobalAction,
  before: string | null,
  after: string,
): GlobalWarningCode[] {
  const warnings: GlobalWarningCode[] = ['TERMINAL_NPM_SWITCH'];
  if (action === 'repair' || before === null) return warnings;
  const from = exact(before);
  const to = exact(after);
  if (!from || !to) return refuse('TARGET_VERSION_UNSUPPORTED');
  const direction = semver.compare(to, from);
  if (action === 'change' && direction === 0) refuse('NO_VERSION_CHANGE');
  if (from.major !== to.major) warnings.push('MAJOR_VERSION_CHANGE');
  if (direction < 0) warnings.push('VERSION_DOWNGRADE');
  return warnings;
}
