import type { IRunnerFileIdentity } from '@/npm-runner/interfaces/npm-runner.types';
import type { IGlobalBin } from '@/global-packages/interfaces/global-packages.types';
import type { IGlobalConfigIdentity } from '@/global-packages/interfaces/global-packages.runtime';
import type { IPnpmGlobalPolicy } from '@/global-packages/interfaces/pnpm-global.types';

// Private, inert facts. Raw config/auth values and executable text never escape readers.
export interface IPnpm10GlobalConfig {
  homeDir: string;
  globalDir: string;
  globalRoot: string;
  binDir: string;
  storeDir: string | null;
  cacheDir: string;
  stateDir: string;
  configDir: string;
  userConfig: string;
  globalConfig: string;
  originalPath: readonly string[];
  selectors: Readonly<Record<string, string>>;
  policy: IPnpmGlobalPolicy;
  configIdentities: readonly IGlobalConfigIdentity[];
  missingConfigPaths: readonly string[];
  directoryIdentities: readonly IRunnerFileIdentity[];
  missingDirectoryPaths: readonly string[];
}

export interface IPnpm10DependencyFacts {
  name: string;
  spec: string;
  version: string;
  linked: boolean;
  logicalPath: string;
  realPath: string;
  linkIdentity: IRunnerFileIdentity;
  directoryIdentity: IRunnerFileIdentity | null;
  manifest: IGlobalConfigIdentity | null;
  bins: readonly IGlobalBin[];
  binIdentities: readonly IRunnerFileIdentity[];
  shims: readonly IGlobalConfigIdentity[];
}

export interface IPnpm10BinSlot {
  name: string;
  identity: IRunnerFileIdentity;
  // null for reserved entries whose destination is deliberately never followed.
  realPath: string | null;
  sha256: string | null;
  owner: string | null;
}

export interface IPnpm10GlobalProjectFacts {
  root: IRunnerFileIdentity | null;
  files: readonly IGlobalConfigIdentity[];
  missingPaths: readonly string[];
  storeDir: string | null;
  storeIdentity: IRunnerFileIdentity | null;
  dependencies: readonly IPnpm10DependencyFacts[];
  ancillary: readonly {
    identity: IRunnerFileIdentity;
    realPath: string;
    sha256: string | null;
  }[];
}

export interface IPnpm10GlobalInventoryFacts {
  project: IPnpm10GlobalProjectFacts;
  binSlots: readonly IPnpm10BinSlot[];
  ownershipComplete: boolean;
}
