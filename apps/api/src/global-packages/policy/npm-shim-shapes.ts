// Inert, exact launcher templates. Unknown builds fail closed; never execute these texts.
export const NODE24_NODE_DIR_SHIMS: Readonly<Record<string, string>> =
  Object.freeze({
    npm: '#!/usr/bin/env bash\n\n# This is used by the Node.js installer, which expects the cygwin/mingw\n# shell script to already be present in the npm dependency folder.\n\n(set -o igncr) 2>/dev/null && set -o igncr; # cygwin encoding fix\n\nbasedir=`dirname "$0"`\n\ncase `uname` in\n  *CYGWIN*) basedir=`cygpath -w "$basedir"`;;\nesac\n\nif [ `uname` = \'Linux\' ] && type wslpath &>/dev/null ; then\n  IS_WSL="true"\nfi\n\nfunction no_node_dir {\n  # if this didn\'t work, then everything else below will fail\n  echo "Could not determine Node.js install directory" >&2\n  exit 1\n}\n\nNODE_EXE="$basedir/node.exe"\nif ! [ -x "$NODE_EXE" ]; then\n  NODE_EXE="$basedir/node"\nfi\nif ! [ -x "$NODE_EXE" ]; then\n  NODE_EXE=node\nfi\n\n# this path is passed to node.exe, so it needs to match whatever\n# kind of paths Node.js thinks it\'s using, typically win32 paths.\nCLI_BASEDIR="$("$NODE_EXE" -p \'require("path").dirname(process.execPath)\' 2> /dev/null)"\nif [ $? -ne 0 ]; then\n  # this fails under WSL 1 so add an additional message. we also suppress stderr above\n  # because the actual error raised is not helpful. in WSL 1 node.exe cannot handle\n  # output redirection properly. See https://github.com/microsoft/WSL/issues/2370\n  if [ "$IS_WSL" == "true" ]; then\n    echo "WSL 1 is not supported. Please upgrade to WSL 2 or above." >&2\n  fi\n  no_node_dir\nfi\nNPM_PREFIX_JS="$CLI_BASEDIR/node_modules/npm/bin/npm-prefix.js"\nNPM_CLI_JS="$CLI_BASEDIR/node_modules/npm/bin/npm-cli.js"\nNPM_PREFIX=`"$NODE_EXE" "$NPM_PREFIX_JS"`\nif [ $? -ne 0 ]; then\n  no_node_dir\nfi\nNPM_PREFIX_NPM_CLI_JS="$NPM_PREFIX/node_modules/npm/bin/npm-cli.js"\n\n# a path that will fail -f test on any posix bash\nNPM_WSL_PATH="/.."\n\n# WSL can run Windows binaries, so we have to give it the win32 path\n# however, WSL bash tests against posix paths, so we need to construct that\n# to know if npm is installed globally.\nif [ "$IS_WSL" == "true" ]; then\n  NPM_WSL_PATH=`wslpath "$NPM_PREFIX_NPM_CLI_JS"`\nfi\nif [ -f "$NPM_PREFIX_NPM_CLI_JS" ] || [ -f "$NPM_WSL_PATH" ]; then\n  NPM_CLI_JS="$NPM_PREFIX_NPM_CLI_JS"\nfi\n\n"$NODE_EXE" "$NPM_CLI_JS" "$@"\n',
    'npm.cmd':
      ':: Created by npm, please don\'t edit manually.\r\n@ECHO OFF\r\n\r\nSETLOCAL\r\n\r\nSET "NODE_EXE=%~dp0\\node.exe"\r\nIF NOT EXIST "%NODE_EXE%" (\r\n  SET "NODE_EXE=node"\r\n)\r\n\r\nSET "NPM_PREFIX_JS=%~dp0\\node_modules\\npm\\bin\\npm-prefix.js"\r\nSET "NPM_CLI_JS=%~dp0\\node_modules\\npm\\bin\\npm-cli.js"\r\nFOR /F "delims=" %%F IN (\'CALL "%NODE_EXE%" "%NPM_PREFIX_JS%"\') DO (\r\n  SET "NPM_PREFIX_NPM_CLI_JS=%%F\\node_modules\\npm\\bin\\npm-cli.js"\r\n)\r\nIF EXIST "%NPM_PREFIX_NPM_CLI_JS%" (\r\n  SET "NPM_CLI_JS=%NPM_PREFIX_NPM_CLI_JS%"\r\n)\r\n\r\n"%NODE_EXE%" "%NPM_CLI_JS%" %*\r\n',
    'npm.ps1':
      '#!/usr/bin/env pwsh\r\n\r\nSet-StrictMode -Version \'Latest\'\r\n\r\n$NODE_EXE="$PSScriptRoot/node.exe"\r\nif (-not (Test-Path $NODE_EXE)) {\r\n  $NODE_EXE="$PSScriptRoot/node"\r\n}\r\nif (-not (Test-Path $NODE_EXE)) {\r\n  $NODE_EXE="node"\r\n}\r\n\r\n$NPM_PREFIX_JS="$PSScriptRoot/node_modules/npm/bin/npm-prefix.js"\r\n$NPM_CLI_JS="$PSScriptRoot/node_modules/npm/bin/npm-cli.js"\r\n$NPM_PREFIX=(& $NODE_EXE $NPM_PREFIX_JS)\r\n\r\nif ($LASTEXITCODE -ne 0) {\r\n  Write-Host "Could not determine Node.js install directory"\r\n  exit 1\r\n}\r\n\r\n$NPM_PREFIX_NPM_CLI_JS="$NPM_PREFIX/node_modules/npm/bin/npm-cli.js"\r\nif (Test-Path $NPM_PREFIX_NPM_CLI_JS) {\r\n  $NPM_CLI_JS=$NPM_PREFIX_NPM_CLI_JS\r\n}\r\n\r\nif ($MyInvocation.ExpectingInput) { # takes pipeline input\r\n  $input | & $NODE_EXE $NPM_CLI_JS $args\r\n} elseif (-not $MyInvocation.Line) { # used "-File" argument\r\n  & $NODE_EXE $NPM_CLI_JS $args\r\n} else { # used "-Command" argument\r\n  if (($MyInvocation | Get-Member -Name \'Statement\') -and $MyInvocation.Statement) {\r\n    $NPM_ORIGINAL_COMMAND = $MyInvocation.Statement\r\n  } else {\r\n    $NPM_ORIGINAL_COMMAND = (\r\n      [Management.Automation.InvocationInfo].GetProperty(\'ScriptPosition\', [Reflection.BindingFlags] \'Instance, NonPublic\')\r\n    ).GetValue($MyInvocation).Text\r\n  }\r\n\r\n  $NODE_EXE = $NODE_EXE.Replace("``", "````")\r\n  $NPM_CLI_JS = $NPM_CLI_JS.Replace("``", "````")\r\n\r\n  $NPM_COMMAND_ARRAY = [Management.Automation.Language.Parser]::ParseInput($NPM_ORIGINAL_COMMAND, [ref] $null, [ref] $null).\r\n    EndBlock.Statements.PipelineElements.CommandElements.Extent.Text\r\n  $NPM_ARGS = ($NPM_COMMAND_ARRAY | Select-Object -Skip 1) -join \' \'\r\n\r\n  Invoke-Expression "& `"$NODE_EXE`" `"$NPM_CLI_JS`" $NPM_ARGS"\r\n}\r\n\r\nexit $LASTEXITCODE\r\n',
    npx: '#!/usr/bin/env bash\n\n# This is used by the Node.js installer, which expects the cygwin/mingw\n# shell script to already be present in the npm dependency folder.\n\n(set -o igncr) 2>/dev/null && set -o igncr; # cygwin encoding fix\n\nbasedir=`dirname "$0"`\n\ncase `uname` in\n  *CYGWIN*) basedir=`cygpath -w "$basedir"`;;\nesac\n\nif [ `uname` = \'Linux\' ] && type wslpath &>/dev/null ; then\n  IS_WSL="true"\nfi\n\nfunction no_node_dir {\n  # if this didn\'t work, then everything else below will fail\n  echo "Could not determine Node.js install directory" >&2\n  exit 1\n}\n\nNODE_EXE="$basedir/node.exe"\nif ! [ -x "$NODE_EXE" ]; then\n  NODE_EXE="$basedir/node"\nfi\nif ! [ -x "$NODE_EXE" ]; then\n  NODE_EXE=node\nfi\n\n# this path is passed to node.exe, so it needs to match whatever\n# kind of paths Node.js thinks it\'s using, typically win32 paths.\nCLI_BASEDIR="$("$NODE_EXE" -p \'require("path").dirname(process.execPath)\' 2> /dev/null)"\nif [ $? -ne 0 ]; then\n  # this fails under WSL 1 so add an additional message. we also suppress stderr above\n  # because the actual error raised is not helpful. in WSL 1 node.exe cannot handle\n  # output redirection properly. See https://github.com/microsoft/WSL/issues/2370\n  if [ "$IS_WSL" == "true" ]; then\n    echo "WSL 1 is not supported. Please upgrade to WSL 2 or above." >&2\n  fi\n  no_node_dir\nfi\nNPM_PREFIX_JS="$CLI_BASEDIR/node_modules/npm/bin/npm-prefix.js"\nNPX_CLI_JS="$CLI_BASEDIR/node_modules/npm/bin/npx-cli.js"\nNPM_PREFIX=`"$NODE_EXE" "$NPM_PREFIX_JS"`\nif [ $? -ne 0 ]; then\n  no_node_dir\nfi\nNPM_PREFIX_NPX_CLI_JS="$NPM_PREFIX/node_modules/npm/bin/npx-cli.js"\n\n# a path that will fail -f test on any posix bash\nNPX_WSL_PATH="/.."\n\n# WSL can run Windows binaries, so we have to give it the win32 path\n# however, WSL bash tests against posix paths, so we need to construct that\n# to know if npm is installed globally.\nif [ "$IS_WSL" == "true" ]; then\n  NPX_WSL_PATH=`wslpath "$NPM_PREFIX_NPX_CLI_JS"`\nfi\nif [ -f "$NPM_PREFIX_NPX_CLI_JS" ] || [ -f "$NPX_WSL_PATH" ]; then\n  NPX_CLI_JS="$NPM_PREFIX_NPX_CLI_JS"\nfi\n\n"$NODE_EXE" "$NPX_CLI_JS" "$@"\n',
    'npx.cmd':
      ':: Created by npm, please don\'t edit manually.\r\n@ECHO OFF\r\n\r\nSETLOCAL\r\n\r\nSET "NODE_EXE=%~dp0\\node.exe"\r\nIF NOT EXIST "%NODE_EXE%" (\r\n  SET "NODE_EXE=node"\r\n)\r\n\r\nSET "NPM_PREFIX_JS=%~dp0\\node_modules\\npm\\bin\\npm-prefix.js"\r\nSET "NPX_CLI_JS=%~dp0\\node_modules\\npm\\bin\\npx-cli.js"\r\nFOR /F "delims=" %%F IN (\'CALL "%NODE_EXE%" "%NPM_PREFIX_JS%"\') DO (\r\n  SET "NPM_PREFIX_NPX_CLI_JS=%%F\\node_modules\\npm\\bin\\npx-cli.js"\r\n)\r\nIF EXIST "%NPM_PREFIX_NPX_CLI_JS%" (\r\n  SET "NPX_CLI_JS=%NPM_PREFIX_NPX_CLI_JS%"\r\n)\r\n\r\n"%NODE_EXE%" "%NPX_CLI_JS%" %*\r\n',
    'npx.ps1':
      '#!/usr/bin/env pwsh\r\n\r\nSet-StrictMode -Version \'Latest\'\r\n\r\n$NODE_EXE="$PSScriptRoot/node.exe"\r\nif (-not (Test-Path $NODE_EXE)) {\r\n  $NODE_EXE="$PSScriptRoot/node"\r\n}\r\nif (-not (Test-Path $NODE_EXE)) {\r\n  $NODE_EXE="node"\r\n}\r\n\r\n$NPM_PREFIX_JS="$PSScriptRoot/node_modules/npm/bin/npm-prefix.js"\r\n$NPX_CLI_JS="$PSScriptRoot/node_modules/npm/bin/npx-cli.js"\r\n$NPM_PREFIX=(& $NODE_EXE $NPM_PREFIX_JS)\r\n\r\nif ($LASTEXITCODE -ne 0) {\r\n  Write-Host "Could not determine Node.js install directory"\r\n  exit 1\r\n}\r\n\r\n$NPM_PREFIX_NPX_CLI_JS="$NPM_PREFIX/node_modules/npm/bin/npx-cli.js"\r\nif (Test-Path $NPM_PREFIX_NPX_CLI_JS) {\r\n  $NPX_CLI_JS=$NPM_PREFIX_NPX_CLI_JS\r\n}\r\n\r\nif ($MyInvocation.ExpectingInput) { # takes pipeline input\r\n  $input | & $NODE_EXE $NPX_CLI_JS $args\r\n} elseif (-not $MyInvocation.Line) { # used "-File" argument\r\n  & $NODE_EXE $NPX_CLI_JS $args\r\n} else { # used "-Command" argument\r\n  if (($MyInvocation | Get-Member -Name \'Statement\') -and $MyInvocation.Statement) {\r\n    $NPX_ORIGINAL_COMMAND = $MyInvocation.Statement\r\n  } else {\r\n    $NPX_ORIGINAL_COMMAND = (\r\n      [Management.Automation.InvocationInfo].GetProperty(\'ScriptPosition\', [Reflection.BindingFlags] \'Instance, NonPublic\')\r\n    ).GetValue($MyInvocation).Text\r\n  }\r\n\r\n  $NODE_EXE = $NODE_EXE.Replace("``", "````")\r\n  $NPX_CLI_JS = $NPX_CLI_JS.Replace("``", "````")\r\n\r\n  $NPX_COMMAND_ARRAY = [Management.Automation.Language.Parser]::ParseInput($NPX_ORIGINAL_COMMAND, [ref] $null, [ref] $null).\r\n    EndBlock.Statements.PipelineElements.CommandElements.Extent.Text\r\n  $NPX_ARGS = ($NPX_COMMAND_ARRAY | Select-Object -Skip 1) -join \' \'\r\n\r\n  Invoke-Expression "& `"$NODE_EXE`" `"$NPX_CLI_JS`" $NPX_ARGS"\r\n}\r\n\r\nexit $LASTEXITCODE\r\n',
  });
export const CMD_SHIM8_PNPM_TARGET = 'node_modules/pnpm/bin/pnpm.mjs';
export const CMD_SHIM8_PNPM_SHIMS: Readonly<Record<string, string>> =
  Object.freeze({
    pnpm: '#!/bin/sh\nbasedir=$(dirname "$(echo "$0" | sed -e \'s,\\\\,/,g\')")\n\ncase `uname` in\n    *CYGWIN*|*MINGW*|*MSYS*)\n        if command -v cygpath > /dev/null 2>&1; then\n            basedir=`cygpath -w "$basedir"`\n        fi\n    ;;\nesac\n\nif [ -x "$basedir/node" ]; then\n  exec "$basedir/node"  "$basedir/node_modules/pnpm/bin/pnpm.mjs" "$@"\nelse \n  exec node  "$basedir/node_modules/pnpm/bin/pnpm.mjs" "$@"\nfi\n',
    'pnpm.cmd':
      '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\pnpm\\bin\\pnpm.mjs" %*\r\n',
    'pnpm.ps1':
      '#!/usr/bin/env pwsh\n$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent\n\n$exe=""\nif ($PSVersionTable.PSVersion -lt "6.0" -or $IsWindows) {\n  # Fix case when both the Windows and Linux builds of Node\n  # are installed in the same directory\n  $exe=".exe"\n}\n$ret=0\nif (Test-Path "$basedir/node$exe") {\n  # Support pipeline input\n  if ($MyInvocation.ExpectingInput) {\n    $input | & "$basedir/node$exe"  "$basedir/node_modules/pnpm/bin/pnpm.mjs" $args\n  } else {\n    & "$basedir/node$exe"  "$basedir/node_modules/pnpm/bin/pnpm.mjs" $args\n  }\n  $ret=$LASTEXITCODE\n} else {\n  # Support pipeline input\n  if ($MyInvocation.ExpectingInput) {\n    $input | & "node$exe"  "$basedir/node_modules/pnpm/bin/pnpm.mjs" $args\n  } else {\n    & "node$exe"  "$basedir/node_modules/pnpm/bin/pnpm.mjs" $args\n  }\n  $ret=$LASTEXITCODE\n}\nexit $ret\n',
  });
const npm12Sh = (target: string): string =>
  [
    '#!/bin/sh',
    String.raw`basedir=$(dirname "$(echo "$0" | sed -e 's,\\,/,g')")`,
    'basedir_win="$basedir"',
    '',
    'case `uname -a` in',
    '  *CYGWIN*|*MINGW*|*MSYS*)',
    '    if command -v cygpath > /dev/null 2>&1; then',
    '      basedir_win=`cygpath -w "$basedir"`',
    '    fi',
    '  ;;',
    '  *WSL2*)',
    '    if command -v wslpath > /dev/null 2>&1; then',
    '      basedir_win="$(wslpath -w "$basedir" 2> /dev/null)"',
    '      if [ $? -ne 0 ] || [ -z "$basedir_win" ]; then',
    '        echo "Error: wslpath failed to convert path. WSL environment may be misconfigured." >&2',
    '        exit 1',
    '      fi',
    '    fi',
    '  ;;',
    'esac',
    '',
    'PROG_EXE="$basedir/node.exe"',
    'if ! [ -x "$PROG_EXE" ]; then',
    '  PROG_EXE="$basedir/node"',
    '  if ! [ -x "$PROG_EXE" ]; then',
    '    PROG_EXE=node',
    '    if ! [ -x "$PROG_EXE" ]; then',
    '      PROG_EXE=node.exe',
    '    fi',
    '  fi',
    'fi',
    '',
    `exec "$PROG_EXE"  "$basedir_win/${target}" "$@"`,
    '',
  ].join('\n');

const npm12Cmd = (target: string): string =>
  [
    '@ECHO off',
    'GOTO start',
    ':find_dp0',
    'SET dp0=%~dp0',
    'EXIT /b',
    ':start',
    'SETLOCAL',
    'CALL :find_dp0',
    '',
    'IF EXIST "%dp0%\\node.exe" (',
    '  SET "_prog=%dp0%\\node.exe"',
    ') ELSE (',
    '  SET "_prog=node"',
    ')',
    '',
    'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & set PATHEXT=%PATHEXT:;.JS;=;% & ' +
      `"%_prog%"  "%dp0%\\${target.replace(/\//g, '\\')}" %*`,
    '',
  ].join('\r\n');

const npm12Ps1 = (target: string): string => {
  const run = (node: string) => [
    '  # Support pipeline input',
    '  if ($MyInvocation.ExpectingInput) {',
    `    $input | & "${node}"  "$basedir/${target}" $args`,
    '  } else {',
    `    & "${node}"  "$basedir/${target}" $args`,
    '  }',
    '  $ret=$LASTEXITCODE',
  ];
  return [
    '#!/usr/bin/env pwsh',
    '$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent',
    '',
    '$exe=""',
    'if ($PSVersionTable.PSVersion -lt "6.0" -or $IsWindows) {',
    '  # Fix case when both the Windows and Linux builds of Node',
    '  # are installed in the same directory',
    '  $exe=".exe"',
    '}',
    '$ret=0',
    'if (Test-Path "$basedir/node$exe") {',
    ...run('$basedir/node$exe'),
    '} else {',
    ...run('node$exe'),
    '}',
    'exit $ret',
    '',
  ].join('\n');
};

/** Real npm 12.2.2 launchers for `target`, relative to the bin directory with `/`. */
export function npm12Shims(
  target: string,
): Record<'' | '.cmd' | '.ps1', string> {
  return {
    '': npm12Sh(target),
    '.cmd': npm12Cmd(target),
    '.ps1': npm12Ps1(target),
  };
}

// Short PowerShell shims of npm 10.9.0 to 11.3.0 (Node 22.12, Node 24.0 to 24.2); they still read npm-prefix.js
// and prefer the prefix npm-cli.js (VC0 F1). Only valid as a whole set with the Node 24 cmd/sh shims.
export const NPM_11_3_PS1_SHIMS: Readonly<Record<string, string>> = {
  'npm.ps1':
    '#!/usr/bin/env pwsh\r\n\r\n$NODE_EXE="$PSScriptRoot/node.exe"\r\nif (-not (Test-Path $NODE_EXE)) {\r\n  $NODE_EXE="$PSScriptRoot/node"\r\n}\r\nif (-not (Test-Path $NODE_EXE)) {\r\n  $NODE_EXE="node"\r\n}\r\n\r\n$NPM_PREFIX_JS="$PSScriptRoot/node_modules/npm/bin/npm-prefix.js"\r\n$NPM_CLI_JS="$PSScriptRoot/node_modules/npm/bin/npm-cli.js"\r\n$NPM_PREFIX=(& $NODE_EXE $NPM_PREFIX_JS)\r\n\r\nif ($LASTEXITCODE -ne 0) {\r\n  Write-Host "Could not determine Node.js install directory"\r\n  exit 1\r\n}\r\n\r\n$NPM_PREFIX_NPM_CLI_JS="$NPM_PREFIX/node_modules/npm/bin/npm-cli.js"\r\nif (Test-Path $NPM_PREFIX_NPM_CLI_JS) {\r\n  $NPM_CLI_JS=$NPM_PREFIX_NPM_CLI_JS\r\n}\r\n\r\n# Support pipeline input\r\nif ($MyInvocation.ExpectingInput) {\r\n  $input | & $NODE_EXE $NPM_CLI_JS $args\r\n} else {\r\n  & $NODE_EXE $NPM_CLI_JS $args\r\n}\r\n\r\nexit $LASTEXITCODE\r\n',
  'npx.ps1':
    '#!/usr/bin/env pwsh\r\n\r\n$NODE_EXE="$PSScriptRoot/node.exe"\r\nif (-not (Test-Path $NODE_EXE)) {\r\n  $NODE_EXE="$PSScriptRoot/node"\r\n}\r\nif (-not (Test-Path $NODE_EXE)) {\r\n  $NODE_EXE="node"\r\n}\r\n\r\n$NPM_PREFIX_JS="$PSScriptRoot/node_modules/npm/bin/npm-prefix.js"\r\n$NPX_CLI_JS="$PSScriptRoot/node_modules/npm/bin/npx-cli.js"\r\n$NPM_PREFIX=(& $NODE_EXE $NPM_PREFIX_JS)\r\n\r\nif ($LASTEXITCODE -ne 0) {\r\n  Write-Host "Could not determine Node.js install directory"\r\n  exit 1\r\n}\r\n\r\n$NPM_PREFIX_NPX_CLI_JS="$NPM_PREFIX/node_modules/npm/bin/npx-cli.js"\r\nif (Test-Path $NPM_PREFIX_NPX_CLI_JS) {\r\n  $NPX_CLI_JS=$NPM_PREFIX_NPX_CLI_JS\r\n}\r\n\r\n# Support pipeline input\r\nif ($MyInvocation.ExpectingInput) {\r\n  $input | & $NODE_EXE $NPX_CLI_JS $args\r\n} else {\r\n  & $NODE_EXE $NPX_CLI_JS $args\r\n}\r\n\r\nexit $LASTEXITCODE\r\n',
};

// PowerShell shims of npm 10.9.3 and 11.4.2 to 11.5.x (Node 22.18 to 22.20, Node 24.3 to 24.7).
export const NPM_10_9_3_PS1_SHIMS: Readonly<Record<string, string>> = {
  'npm.ps1':
    '#!/usr/bin/env pwsh\r\n\r\n$NODE_EXE="$PSScriptRoot/node.exe"\r\nif (-not (Test-Path $NODE_EXE)) {\r\n  $NODE_EXE="$PSScriptRoot/node"\r\n}\r\nif (-not (Test-Path $NODE_EXE)) {\r\n  $NODE_EXE="node"\r\n}\r\n\r\n$NPM_PREFIX_JS="$PSScriptRoot/node_modules/npm/bin/npm-prefix.js"\r\n$NPM_CLI_JS="$PSScriptRoot/node_modules/npm/bin/npm-cli.js"\r\n$NPM_PREFIX=(& $NODE_EXE $NPM_PREFIX_JS)\r\n\r\nif ($LASTEXITCODE -ne 0) {\r\n  Write-Host "Could not determine Node.js install directory"\r\n  exit 1\r\n}\r\n\r\n$NPM_PREFIX_NPM_CLI_JS="$NPM_PREFIX/node_modules/npm/bin/npm-cli.js"\r\nif (Test-Path $NPM_PREFIX_NPM_CLI_JS) {\r\n  $NPM_CLI_JS=$NPM_PREFIX_NPM_CLI_JS\r\n}\r\n\r\nif ($MyInvocation.ExpectingInput) { # takes pipeline input\r\n  $input | & $NODE_EXE $NPM_CLI_JS $args\r\n} elseif (-not $MyInvocation.Line) { # used "-File" argument\r\n  & $NODE_EXE $NPM_CLI_JS $args\r\n} else { # used "-Command" argument\r\n  if ($MyInvocation.Statement) {\r\n    $NPM_ORIGINAL_COMMAND = $MyInvocation.Statement\r\n  } else {\r\n    $NPM_ORIGINAL_COMMAND = (\r\n      [Management.Automation.InvocationInfo].GetProperty(\'ScriptPosition\', [Reflection.BindingFlags] \'Instance, NonPublic\')\r\n    ).GetValue($MyInvocation).Text\r\n  }\r\n\r\n  $NODE_EXE = $NODE_EXE.Replace("``", "````")\r\n  $NPM_CLI_JS = $NPM_CLI_JS.Replace("``", "````")\r\n\r\n  $NPM_NO_REDIRECTS_COMMAND = [Management.Automation.Language.Parser]::ParseInput($NPM_ORIGINAL_COMMAND, [ref] $null, [ref] $null).\r\n    EndBlock.Statements.PipelineElements.CommandElements.Extent.Text -join \' \'\r\n  $NPM_ARGS = $NPM_NO_REDIRECTS_COMMAND.Substring($MyInvocation.InvocationName.Length).Trim()\r\n\r\n  Invoke-Expression "& `"$NODE_EXE`" `"$NPM_CLI_JS`" $NPM_ARGS"\r\n}\r\n\r\nexit $LASTEXITCODE\r\n',
  'npx.ps1':
    '#!/usr/bin/env pwsh\r\n\r\n$NODE_EXE="$PSScriptRoot/node.exe"\r\nif (-not (Test-Path $NODE_EXE)) {\r\n  $NODE_EXE="$PSScriptRoot/node"\r\n}\r\nif (-not (Test-Path $NODE_EXE)) {\r\n  $NODE_EXE="node"\r\n}\r\n\r\n$NPM_PREFIX_JS="$PSScriptRoot/node_modules/npm/bin/npm-prefix.js"\r\n$NPX_CLI_JS="$PSScriptRoot/node_modules/npm/bin/npx-cli.js"\r\n$NPM_PREFIX=(& $NODE_EXE $NPM_PREFIX_JS)\r\n\r\nif ($LASTEXITCODE -ne 0) {\r\n  Write-Host "Could not determine Node.js install directory"\r\n  exit 1\r\n}\r\n\r\n$NPM_PREFIX_NPX_CLI_JS="$NPM_PREFIX/node_modules/npm/bin/npx-cli.js"\r\nif (Test-Path $NPM_PREFIX_NPX_CLI_JS) {\r\n  $NPX_CLI_JS=$NPM_PREFIX_NPX_CLI_JS\r\n}\r\n\r\nif ($MyInvocation.ExpectingInput) { # takes pipeline input\r\n  $input | & $NODE_EXE $NPX_CLI_JS $args\r\n} elseif (-not $MyInvocation.Line) { # used "-File" argument\r\n  & $NODE_EXE $NPX_CLI_JS $args\r\n} else { # used "-Command" argument\r\n  if ($MyInvocation.Statement) {\r\n    $NPX_ORIGINAL_COMMAND = $MyInvocation.Statement\r\n  } else {\r\n    $NPX_ORIGINAL_COMMAND = (\r\n      [Management.Automation.InvocationInfo].GetProperty(\'ScriptPosition\', [Reflection.BindingFlags] \'Instance, NonPublic\')\r\n    ).GetValue($MyInvocation).Text\r\n  }\r\n\r\n  $NODE_EXE = $NODE_EXE.Replace("``", "````")\r\n  $NPX_CLI_JS = $NPX_CLI_JS.Replace("``", "````")\r\n\r\n  $NPX_NO_REDIRECTS_COMMAND = [Management.Automation.Language.Parser]::ParseInput($NPX_ORIGINAL_COMMAND, [ref] $null, [ref] $null).\r\n    EndBlock.Statements.PipelineElements.CommandElements.Extent.Text -join \' \'\r\n  $NPX_ARGS = $NPX_NO_REDIRECTS_COMMAND.Substring($MyInvocation.InvocationName.Length).Trim()\r\n\r\n  Invoke-Expression "& `"$NODE_EXE`" `"$NPX_CLI_JS`" $NPX_ARGS"\r\n}\r\n\r\nexit $LASTEXITCODE\r\n',
};

// Node-dir shims are byte copies of the bundled npm's bin/ files, so they change with the npm a Node
// release bundles (VC0). One set per distinct npm shim release used by Node 22.18+ and Node 24; the
// sh and cmd shims are the same in all of them. Delegation must match one whole set.
export const NODE_DIR_SHIM_SETS: readonly Readonly<Record<string, string>>[] = [
  NODE24_NODE_DIR_SHIMS,
  { ...NODE24_NODE_DIR_SHIMS, ...NPM_10_9_3_PS1_SHIMS },
  { ...NODE24_NODE_DIR_SHIMS, ...NPM_11_3_PS1_SHIMS },
];
