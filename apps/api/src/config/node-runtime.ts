import * as semver from 'semver';

/** Oldest Node.js release PkgSteward is tested on. Older versions are warned about, never blocked. */
export const SUPPORTED_NODE_MINIMUM = '22.18.0';
export const SUPPORTED_NODE_RANGE = `>=${SUPPORTED_NODE_MINIMUM}`;

/** English warning for an unsupported Node.js version, or null when it is supported. */
export function nodeRuntimeNotice(version: string): string | null {
  // RC/nightly builds of a newer Node are supported; semver skips prereleases unless asked.
  if (
    semver.valid(version) &&
    semver.satisfies(version, SUPPORTED_NODE_RANGE, { includePrerelease: true })
  )
    return null;
  const floor = SUPPORTED_NODE_MINIMUM.split('.').slice(0, 2).join('.');
  return `Node.js ${version} is older than the supported ${SUPPORTED_NODE_MINIMUM} or could not be read. PkgSteward may fail to start or behave incorrectly; use Node.js ${floor} or newer.`;
}
