import * as semver from 'semver';

/** Node.js range PkgSteward is tested on. Older versions are warned about, never blocked. */
export const SUPPORTED_NODE_RANGE = '>=22.18.0';

/** English warning for an unsupported Node.js version, or null when it is supported. */
export function nodeRuntimeNotice(version: string): string | null {
  if (semver.valid(version) && semver.satisfies(version, SUPPORTED_NODE_RANGE))
    return null;
  return `Node.js ${version} is older than the supported 22.18.0 or could not be read. PkgSteward may fail to start or behave incorrectly; use Node.js 22.18 or newer.`;
}
