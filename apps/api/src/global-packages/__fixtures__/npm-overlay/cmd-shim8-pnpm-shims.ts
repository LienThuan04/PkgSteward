// TEST không phải yêu cầu nghiệp vụ. Inert shim text, never run.
// Exact bytes of real cmd-shim 8.0.0 launchers that bundled npm 11.17.0 wrote into a global prefix
// for pnpm 11.22.0 (target node_modules/pnpm/bin/pnpm.mjs), captured read-only on 2026-11-11.
// npm-self tests derive npm/npx launchers by replacing only the target path (M9G A1, A16).
export const CMD_SHIM8_PNPM_TARGET = 'node_modules/pnpm/bin/pnpm.mjs';
export const CMD_SHIM8_PNPM_SHIMS: Readonly<Record<string, string>> =
  Object.freeze({
    // 403 bytes, 0 CRLF, sha256 2a34c908e4c9799ace321ebd1d438c02a5d8e55da5a4955efbbf1d3df3288ec4
    pnpm: '#!/bin/sh\nbasedir=$(dirname "$(echo "$0" | sed -e \'s,\\\\,/,g\')")\n\ncase `uname` in\n    *CYGWIN*|*MINGW*|*MSYS*)\n        if command -v cygpath > /dev/null 2>&1; then\n            basedir=`cygpath -w "$basedir"`\n        fi\n    ;;\nesac\n\nif [ -x "$basedir/node" ]; then\n  exec "$basedir/node"  "$basedir/node_modules/pnpm/bin/pnpm.mjs" "$@"\nelse \n  exec node  "$basedir/node_modules/pnpm/bin/pnpm.mjs" "$@"\nfi\n',
    // 332 bytes, 17 CRLF, sha256 0c51f0af9d72804ff809c56efb708ee1e6c250b321c1081db510f61440e50320
    'pnpm.cmd':
      '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\pnpm\\bin\\pnpm.mjs" %*\r\n',
    // 833 bytes, 0 CRLF, sha256 cf074d63e1573c01a30592688c7dff15cd75ad4530effd8cad64f128b9070b1b
    'pnpm.ps1':
      '#!/usr/bin/env pwsh\n$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent\n\n$exe=""\nif ($PSVersionTable.PSVersion -lt "6.0" -or $IsWindows) {\n  # Fix case when both the Windows and Linux builds of Node\n  # are installed in the same directory\n  $exe=".exe"\n}\n$ret=0\nif (Test-Path "$basedir/node$exe") {\n  # Support pipeline input\n  if ($MyInvocation.ExpectingInput) {\n    $input | & "$basedir/node$exe"  "$basedir/node_modules/pnpm/bin/pnpm.mjs" $args\n  } else {\n    & "$basedir/node$exe"  "$basedir/node_modules/pnpm/bin/pnpm.mjs" $args\n  }\n  $ret=$LASTEXITCODE\n} else {\n  # Support pipeline input\n  if ($MyInvocation.ExpectingInput) {\n    $input | & "node$exe"  "$basedir/node_modules/pnpm/bin/pnpm.mjs" $args\n  } else {\n    & "node$exe"  "$basedir/node_modules/pnpm/bin/pnpm.mjs" $args\n  }\n  $ret=$LASTEXITCODE\n}\nexit $ret\n',
  });
