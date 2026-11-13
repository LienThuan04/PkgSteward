import { win32 } from 'node:path';
import type { IRunnerFs } from '@/npm-runner/interfaces/npm-runner.types';
import type { IPnpm10BinSlot } from '../interfaces/pnpm10-global.types';
import type { IGlobalConfigIdentity } from '../interfaces/global-packages.runtime';
import { isGlobalAbsolutePath } from '../execution/global-command';
import {
  assertGlobalDirectory,
  readGlobalDirectory,
} from '../discovery/global-location';
import { readPnpm10File } from '../config/pnpm10-global-config';
import {
  runnerIdentity,
  sameRunnerIdentity,
} from '@/npm-runner/toolchain/runner-tool';
// pnpm.cjs:102203-102430. Exact node/no-extra-args family, with path operands
// substituted only from independently proven facts. No text is evaluated.
const SHAPES = {
  '': '#!/bin/sh\nbasedir=$(dirname "$(echo "$0" | sed -e \'s,\\\\,/,g\')")\n\ncase `uname` in\n    *CYGWIN*|*MINGW*|*MSYS*)\n        if command -v cygpath > /dev/null 2>&1; then\n            basedir=`cygpath -w "$basedir"`\n        fi\n    ;;\nesac\n\nif [ -z "$NODE_PATH" ]; then\n  export NODE_PATH="{{posixPaths}}"\nelse\n  export NODE_PATH="{{posixPaths}}:$NODE_PATH"\nfi\nif [ -x "$basedir/node" ]; then\n  exec "$basedir/node"  {{shTarget}} "$@"\nelse\n  exec node  {{shTarget}} "$@"\nfi\n',
  '.cmd':
    '@SETLOCAL\n@IF NOT DEFINED NODE_PATH (\n  @SET "NODE_PATH={{winPaths}}"\n) ELSE (\n  @SET "NODE_PATH={{winPaths}};%NODE_PATH%"\n)\n@IF EXIST "%~dp0\\node.exe" (\n  "%~dp0\\node.exe"  {{cmdTarget}} %*\n) ELSE (\n  @SET PATHEXT=%PATHEXT:;.JS;=;%\n  node  {{cmdTarget}} %*\n)\n',
  '.ps1':
    '#!/usr/bin/env pwsh\n$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent\n\n$exe=""\n$pathsep=":"\n$env_node_path=$env:NODE_PATH\n$new_node_path="{{winPaths}}"\nif ($PSVersionTable.PSVersion -lt "6.0" -or $IsWindows) {\n  # Fix case when both the Windows and Linux builds of Node\n  # are installed in the same directory\n  $exe=".exe"\n  $pathsep=";"\n} else {\n  $new_node_path="{{posixPaths}}"\n}\nif ([string]::IsNullOrEmpty($env_node_path)) {\n  $env:NODE_PATH=$new_node_path\n} else {\n  $env:NODE_PATH="$new_node_path$pathsep$env_node_path"\n}\n\n$ret=0\nif (Test-Path "$basedir/node$exe") {\n  # Support pipeline input\n  if ($MyInvocation.ExpectingInput) {\n    $input | & "$basedir/node$exe"  {{shTarget}} $args\n  } else {\n    & "$basedir/node$exe"  {{shTarget}} $args\n  }\n  $ret=$LASTEXITCODE\n} else {\n  # Support pipeline input\n  if ($MyInvocation.ExpectingInput) {\n    $input | & "node$exe"  {{shTarget}} $args\n  } else {\n    & "node$exe"  {{shTarget}} $args\n  }\n  $ret=$LASTEXITCODE\n}\n$env:NODE_PATH=$env_node_path\nexit $ret\n',
} as const;

export interface IPnpm10ShimInput {
  text: string;
  shimPath: string;
  nodePath: string;
  target: string;
  // Derived from proven package/virtual-store facts, never from wrapper text.
  nodePaths: readonly string[];
}
const safePath = (p: string): boolean =>
  isGlobalAbsolutePath(p) && !/[$%`!;&|<>^(){}\r\n"]/.test(p);
const compare = (p: string): string => win32.resolve(p).toLowerCase();

export function provePnpm10Shim(input: IPnpm10ShimInput): boolean {
  if (
    Buffer.byteLength(input.text) > 64 * 1024 ||
    !input.nodePaths.length ||
    input.nodePaths.length > 8 ||
    ![input.shimPath, input.nodePath, input.target, ...input.nodePaths].every(
      safePath,
    ) ||
    win32.basename(input.nodePath).toLowerCase() !== 'node.exe'
  )
    return false;
  const ext = win32.extname(input.shimPath).toLowerCase();
  if (ext !== '' && ext !== '.cmd' && ext !== '.ps1') return false;
  const relative = win32.relative(win32.dirname(input.shimPath), input.target);
  const cmdTarget = win32.isAbsolute(relative)
    ? `"${relative}"`
    : `"%~dp0\\${relative}"`;
  const sh = relative.replace(/\\/g, '/');
  const shTarget = win32.isAbsolute(relative) ? `"${sh}"` : `"$basedir/${sh}"`;
  const winPaths = input.nodePaths.map((p) => p.replace(/\//g, '\\')).join(';');
  // pnpm.cjs:102418-102430: Windows shell path forms differ by MSYSTEM.
  return ['/proc/cygdrive', '/mnt'].some((mount) => {
    const posixPaths = input.nodePaths
      .map((p) =>
        p
          .replace(/\\/g, '/')
          .replace(
            /^([a-z]):/i,
            (_, drive: string) => `${mount}/${drive.toLowerCase()}`,
          ),
      )
      .join(':');
    const expected = SHAPES[ext]
      .replaceAll('{{winPaths}}', winPaths)
      .replaceAll('{{posixPaths}}', posixPaths)
      .replaceAll('{{cmdTarget}}', cmdTarget)
      .replaceAll('{{shTarget}}', shTarget);
    return input.text.replace(/\r\n/g, '\n') === expected;
  });
}

export interface IPnpm10BinDirectory {
  complete: boolean;
  slots: IPnpm10BinSlot[];
  // Ephemeral proof input only; never copy text into inventory/preview facts.
  texts: ReadonlyMap<string, string>;
}

export async function readPnpm10BinDirectory(input: {
  fs: IRunnerFs;
  signal: AbortSignal;
  binDir: string;
  budget: { remaining: number };
}): Promise<IPnpm10BinDirectory> {
  const { fs, signal, binDir, budget } = input;
  const guard = () => assertGlobalDirectory(binDir, fs, signal);
  signal.throwIfAborted();
  await guard();
  const before = runnerIdentity(binDir, await fs.lstat(binDir));
  signal.throwIfAborted();
  const names = await readGlobalDirectory(fs, binDir, signal);
  const sorted = [...names].sort();
  const result: IPnpm10BinDirectory = {
    complete: new Set(names.map((n) => n.toLowerCase())).size === names.length,
    slots: [],
    texts: new Map(),
  };
  const texts = new Map<string, string>();
  for (let index = 0; index < sorted.length; index++) {
    signal.throwIfAborted();
    if (index % 128 === 127) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      signal.throwIfAborted();
    }
    const name = sorted[index];
    const path = win32.join(binDir, name);
    const identity = runnerIdentity(path, await fs.lstat(path));
    signal.throwIfAborted();
    // Reserve directories and reparses without recursing or following them.
    const slot: IPnpm10BinSlot = {
      name,
      identity,
      realPath: null,
      sha256: null,
      owner: null,
    };
    const ext = win32.extname(name).toLowerCase();
    if (
      ['', '.cmd', '.ps1'].includes(ext) &&
      identity.stat.isFile() &&
      !identity.stat.isSymbolicLink() &&
      identity.stat.size <= 64 * 1024
    ) {
      const data = await readPnpm10File(
        path,
        64 * 1024,
        fs,
        signal,
        budget,
        guard,
        true,
      );
      if (!data || !sameRunnerIdentity(identity.stat, data.identity.file.stat))
        result.complete = false;
      else {
        slot.realPath = path;
        slot.sha256 = data.identity.sha256;
        texts.set(name.toLowerCase(), data.text);
      }
    }
    result.slots.push(slot);
  }
  await guard();
  const after = await fs.lstat(binDir);
  signal.throwIfAborted();
  const afterNames = [
    ...(await readGlobalDirectory(fs, binDir, signal)),
  ].sort();
  if (
    !sameRunnerIdentity(before.stat, after) ||
    JSON.stringify(sorted) !== JSON.stringify(afterNames)
  )
    result.complete = false;
  return { ...result, texts };
}

export function provePnpm10BinSet(input: {
  directory: IPnpm10BinDirectory;
  binName: string;
  target: string;
  nodePath: string;
  nodePaths: readonly string[];
}): IGlobalConfigIdentity[] | null {
  const { directory: d, binName } = input;
  if (
    !d.complete ||
    !/^[a-z0-9@._+-]+$/i.test(binName) ||
    /\.(?:cmd|ps1|exe|bat|com)$/i.test(binName)
  )
    return null;
  const normalized = binName.toLowerCase();
  const slots = d.slots.filter(
    (slot) =>
      slot.name.toLowerCase().replace(/\.(?:cmd|ps1|exe|bat|com)$/i, '') ===
      normalized,
  );
  if (slots.length !== 3) return null;
  const facts: IGlobalConfigIdentity[] = [];
  for (const ext of ['', '.cmd', '.ps1']) {
    const slot = slots.find(
      (s) => s.name.toLowerCase() === `${normalized}${ext}`,
    );
    const text = slot && d.texts.get(slot.name.toLowerCase());
    if (
      !slot ||
      text === undefined ||
      !slot.sha256 ||
      slot.identity.stat.isSymbolicLink() ||
      !provePnpm10Shim({ ...input, text, shimPath: slot.identity.path })
    )
      return null;
    facts.push({ file: slot.identity, sha256: slot.sha256 });
  }
  // A local Node would take precedence over the verified PATH Node. Reserve it
  // unless it is exactly the verified executable (production discovery pins it).
  if (
    d.slots.some(
      (s) =>
        /^node(?:\.exe)?$/i.test(s.name) &&
        compare(s.identity.path) !== compare(input.nodePath),
    )
  )
    return null;
  return facts;
}
