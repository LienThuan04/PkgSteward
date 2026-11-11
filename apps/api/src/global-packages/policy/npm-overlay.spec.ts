import { AppException } from '@/common/exceptions/app.exception';
import {
  assertNpmOverlayMutable,
  assertNpmTarget,
  classifyNpmOverlay,
  npmRetireCandidates,
  npmRetirePath,
  npmSelfWarnings,
  proveNodeDirShim,
  proveNpmShim,
} from './npm-overlay';
import { npm12Shims } from '../__fixtures__/npm12/shims';
import { CMD_SHIM8_PNPM_SHIMS } from '../__fixtures__/npm-overlay/cmd-shim8-pnpm-shims';
import { NODE24_NODE_DIR_SHIMS } from '../__fixtures__/npm-overlay/node-dir-shims';
import {
  npmSelfFacts,
  npmEntry,
  npmTarget,
  npmPresent,
} from '../__fixtures__/npm-overlay/facts';
import type { IGlobalTargetFacts } from '../interfaces/global-packages.runtime';

const reason = (run: () => unknown, expected: string) => {
  try {
    run();
    throw new Error('TEST expected refusal');
  } catch (error) {
    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).details).toMatchObject({ reason: expected });
  }
};

describe('npm-self target policy', () => {
  it.each(['11.21.2', '12.2.2'])('accepts supported exact %s', (version) => {
    expect(() =>
      assertNpmTarget(npmTarget({ version }), '24.19.0', '11.17.0'),
    ).not.toThrow();
  });
  it.each<Partial<IGlobalTargetFacts>>([
    { version: '10.9.10' },
    { version: '13.0.0' },
    { version: '12.0.0-beta.1' },
    { version: 'v12.2.2' },
    { deprecated: true },
    { name: 'pnpm' },
    { bins: [{ name: 'npm', target: 'bin/npm-cli.js' }] },
    {
      bins: [
        { name: 'npm', target: 'bin/npx-cli.js' },
        { name: 'npx', target: 'bin/npm-cli.js' },
      ],
    },
  ])('rejects unsupported target %p', (patch) => {
    reason(
      () => assertNpmTarget(npmTarget(patch), '24.19.0', '11.17.0'),
      'TARGET_VERSION_UNSUPPORTED',
    );
  });
  it.each([null, '', '   ', 'not a range', '>=26'])(
    'rejects engines %p',
    (engines) => {
      reason(
        () => assertNpmTarget(npmTarget({ engines }), '24.19.0', null),
        'ENGINE_UNSUPPORTED',
      );
    },
  );
  it('compares change against terminal npm rather than app npm', () => {
    reason(
      () => assertNpmTarget(npmTarget(), '24.19.0', '12.2.2'),
      'NO_VERSION_CHANGE',
    );
  });
});

describe('strict inert shim proof', () => {
  for (const bin of ['npm', 'npx']) {
    for (const ext of ['', '.cmd', '.ps1'] as const) {
      const name = `${bin}${ext}`;
      const target = `node_modules/npm/bin/${bin}-cli.js`;
      const oldTarget =
        ext === '.cmd'
          ? 'node_modules\\pnpm\\bin\\pnpm.mjs'
          : 'node_modules/pnpm/bin/pnpm.mjs';
      const replacement = ext === '.cmd' ? target.replace(/\//g, '\\') : target;
      const oldShim = CMD_SHIM8_PNPM_SHIMS[`pnpm${ext}`]
        .split(oldTarget)
        .join(replacement);
      for (const [version, text] of [
        ['8', oldShim],
        ['9', npm12Shims(target)[ext]],
      ]) {
        it(`proves cmd-shim ${version} ${name} and rejects altered scripts`, () => {
          expect(proveNpmShim(name, text)).toBe('proven');
          expect(proveNpmShim(name, '')).toBe('empty');
          for (const bad of [
            text + '\necho foreign\n',
            text.slice(0, -4),
            text.replace(`${bin}-cli.js`, 'other.js'),
            text.replace(
              `${bin}-cli.js`,
              `${bin === 'npm' ? 'npx' : 'npm'}-cli.js`,
            ),
            text
              .replace('#!/bin/sh', '#!/bin/bash')
              .replace('@ECHO off', '@echo on')
              .replace('#!/usr/bin/env pwsh', '#!/usr/bin/env powershell'),
          ])
            expect(proveNpmShim(name, bad)).toBe('foreign');
        });
      }
      it(`proves Node-dir delegation ${name} only for the captured build`, () => {
        const text = NODE24_NODE_DIR_SHIMS[name];
        expect(proveNodeDirShim(name, text)).toBe('verified');
        for (const bad of [
          text.replace(/npm-prefix\.js/g, 'other.js'),
          text.replace(new RegExp(`${bin}-cli\\.js`, 'g'), 'other-cli.js'),
          text.slice(0, -4),
          '',
        ])
          expect(proveNodeDirShim(name, bad)).toBe('unverified');
      });
    }
  }
  it('does not prove unknown shim names', () => {
    expect(proveNpmShim('pnpm', '')).toBe('foreign');
    expect(proveNodeDirShim('pnpm', '')).toBe('unverified');
  });
});

describe('overlay state and exact repair targets', () => {
  it('keeps absent explicit without a fabricated manifest', () => {
    expect(classifyNpmOverlay(npmSelfFacts())).toMatchObject({
      state: 'absent',
      repairTargets: [],
    });
  });
  it('requires all six proven S members for present', () => {
    const facts = npmPresent();
    expect(classifyNpmOverlay(facts).state).toBe('present');
    facts.shims[0].entry = null;
    expect(classifyNpmOverlay(facts).state).toBe('broken');
  });
  it.each(['missing', 'name', 'version', 'bins'])(
    'keeps invalid %s overlay metadata repairable',
    (field) => {
      const facts = npmPresent();
      if (field === 'missing') facts.overlay!.package = null;
      else if (field === 'name') facts.overlay!.package!.name = 'other';
      else if (field === 'version') facts.overlay!.package!.version = 'v12.2.2';
      else facts.overlay!.package!.bins = [];
      const result = assertNpmOverlayMutable('repair', facts);
      expect(result.state).toBe('broken');
      expect(result.repairTargets.at(-1)?.path).toBe(
        'D:\\TEST\\prefix\\node_modules\\npm',
      );
    },
  );
  it('refuses repair targets overlapping a protected tree', () => {
    const facts = npmPresent();
    facts.shims[0].entry = null;
    facts.protectedPaths = ['D:\\TEST\\prefix\\node_modules\\npm\\protected'];
    reason(() => assertNpmOverlayMutable('repair', facts), 'BIN_CONFLICT');
  });
  it('requires a complete observation of S even when every supplied entry is absent', () => {
    const facts = npmSelfFacts();
    facts.shims.pop();
    reason(() => assertNpmOverlayMutable('repair', facts), 'BIN_CONFLICT');
  });
  it('refuses repair without a stable filesystem identity', () => {
    const facts = npmPresent();
    facts.shims[0].entry = null;
    // Stats without an inode number cannot prove identity.
    Reflect.deleteProperty(facts.overlay!.directory.identity.stat, 'ino');
    reason(() => assertNpmOverlayMutable('repair', facts), 'BIN_CONFLICT');
  });
  it('includes a valid overlay when retired artifacts make it broken; orders targets', () => {
    const facts = npmPresent();
    facts.retired = [
      npmEntry(
        npmRetirePath('D:\\TEST\\prefix\\node_modules\\npm'),
        'directory',
      ),
      npmEntry(npmRetirePath('D:\\TEST\\prefix\\npm.cmd')),
    ];
    const result = classifyNpmOverlay(facts);
    expect(result.state).toBe('broken');
    expect(result.repairTargets.map((entry) => entry.path)).toEqual([
      ...facts.shims.map((shim) => shim.entry!.path),
      'D:\\TEST\\prefix\\node_modules\\npm',
      ...facts.retired.map((entry) => entry.path),
    ]);
  });
  it('detects retired-only state and empty shims as repairable broken', () => {
    const facts = npmSelfFacts();
    facts.retired = [npmEntry(npmRetirePath('D:\\TEST\\prefix\\npm'))];
    facts.shims[0].entry = npmEntry('D:\\TEST\\prefix\\npm', 'file', '');
    expect(classifyNpmOverlay(facts)).toMatchObject({
      state: 'broken',
      repairReason: null,
    });
  });
  it.each(['foreign', 'partial', 'large', 'reparse'])(
    'refuses unsafe %s S members',
    (kind) => {
      const facts = npmPresent();
      const entry = facts.shims[0].entry!;
      if (kind === 'reparse') entry.reparse = true;
      else if (kind === 'large') entry.identity.stat.size = 65537;
      else
        entry.text =
          kind === 'foreign' ? 'echo foreign\n' : entry.text!.slice(0, -4);
      expect(classifyNpmOverlay(facts)).toMatchObject({
        state: 'broken',
        repairReason: kind === 'reparse' ? 'LINKED_PACKAGE' : 'BIN_CONFLICT',
        repairTargets: [],
      });
      reason(
        () => assertNpmOverlayMutable('repair', facts),
        kind === 'reparse' ? 'LINKED_PACKAGE' : 'BIN_CONFLICT',
      );
    },
  );
  it('marks a reparse overlay linked and refuses every action', () => {
    const facts = npmPresent();
    facts.overlay!.directory.reparse = true;
    for (const action of ['change', 'remove', 'repair'] as const)
      reason(() => assertNpmOverlayMutable(action, facts), 'LINKED_PACKAGE');
    expect(classifyNpmOverlay(facts).state).toBe('linked');
  });
  it.each(['C:\\NODE\\', 'C:\\Node\\child', 'C:\\'])(
    'checks overlapping prefix %s before overlay state',
    (prefixReal) => {
      const facts = npmSelfFacts();
      facts.prefixReal = prefixReal;
      expect(classifyNpmOverlay(facts)).toMatchObject({
        state: 'unsupported',
        reason: 'NPM_PREFIX_IS_NODE_DIR',
      });
    },
  );
  it('checks real overlay overlap with bundled npm', () => {
    const facts = npmPresent();
    facts.overlay!.directory.realPath = 'c:\\node\\node_modules\\npm';
    expect(classifyNpmOverlay(facts).reason).toBe('NPM_PREFIX_IS_NODE_DIR');
  });
  it('does not confuse a sibling prefix with the Node directory', () => {
    const facts = npmSelfFacts();
    facts.nodeDir = 'D:\\TEST\\prefix-other';
    expect(classifyNpmOverlay(facts).state).toBe('absent');
  });
  it('requires broken for repair and present for restore', () => {
    reason(
      () => assertNpmOverlayMutable('repair', npmSelfFacts()),
      'NPM_OVERLAY_NOT_BROKEN',
    );
    reason(
      () => assertNpmOverlayMutable('remove', npmSelfFacts()),
      'NPM_OVERLAY_ABSENT',
    );
    reason(
      () => assertNpmOverlayMutable('repair', npmPresent()),
      'NPM_OVERLAY_NOT_BROKEN',
    );
  });
  it('allows restore/repair with unverified delegation but refuses change', () => {
    const facts = npmPresent();
    facts.nodeDirShims[0].entry!.text = 'unknown';
    reason(
      () => assertNpmOverlayMutable('change', facts),
      'NPM_DELEGATION_UNVERIFIED',
    );
    expect(() => assertNpmOverlayMutable('remove', facts)).not.toThrow();
    facts.shims[0].entry = null;
    expect(() => assertNpmOverlayMutable('repair', facts)).not.toThrow();
  });
  it('refuses arbitrary retired paths and mismatched realpaths', () => {
    const facts = npmSelfFacts();
    facts.retired = [
      npmEntry('D:\\TEST\\prefix\\node_modules\\.npm-arbitrary', 'directory'),
    ];
    reason(() => assertNpmOverlayMutable('repair', facts), 'BIN_CONFLICT');
    facts.retired = [npmEntry(npmRetirePath('D:\\TEST\\prefix\\npm'))];
    facts.retired[0].realPath = 'D:\\elsewhere';
    reason(() => assertNpmOverlayMutable('repair', facts), 'LINKED_PACKAGE');
  });
});

describe('npm retire algorithm and terminal warnings', () => {
  it('hashes the exact string and enumerates resolved/real drive variants only', () => {
    const path = 'D:\\TEST\\prefix\\node_modules\\npm';
    // Independently calculated with .NET SHA1 over the exact UTF-8 input.
    expect(npmRetirePath(path)).toBe(
      'D:\\TEST\\prefix\\node_modules\\.npm-p9Z75ZzS',
    );
    const candidates = npmRetireCandidates(
      'D:\\TEST\\prefix',
      'D:\\RealPrefix',
      'node_modules\\npm',
    );
    expect(candidates).toEqual([
      'D:\\TEST\\prefix\\node_modules\\.npm-p9Z75ZzS',
      'd:\\TEST\\prefix\\node_modules\\.npm-lzMu51qr',
      'D:\\RealPrefix\\node_modules\\.npm-7PoMxzRi',
      'd:\\RealPrefix\\node_modules\\.npm-PV35f8DF',
    ]);
    expect(
      npmRetireCandidates('D:\\TEST\\prefix', 'D:\\TEST\\prefix', 'npm.cmd'),
    ).toHaveLength(2);
  });
  it('restores at equal version and warns from the terminal version for remove', () => {
    expect(npmSelfWarnings('remove', '11.17.0', '11.17.0')).toEqual([
      'TERMINAL_NPM_SWITCH',
    ]);
    expect(npmSelfWarnings('remove', '12.2.2', '11.17.0')).toEqual([
      'TERMINAL_NPM_SWITCH',
      'MAJOR_VERSION_CHANGE',
      'VERSION_DOWNGRADE',
    ]);
    expect(npmSelfWarnings('repair', null, '11.17.0')).toEqual([
      'TERMINAL_NPM_SWITCH',
    ]);
    reason(
      () => npmSelfWarnings('change', '12.2.2', '12.2.2'),
      'NO_VERSION_CHANGE',
    );
  });
});
