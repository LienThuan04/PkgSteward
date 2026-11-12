// JS thuần, không import .ts: phải chạy được cả trên Node quá cũ để còn in cảnh báo.
export const SUPPORTED_NODE_MINIMUM = "22.18.0"
const FLOOR = SUPPORTED_NODE_MINIMUM.split(".").map(Number)

/** English warning for an unsupported Node.js version, or null when it is supported (never blocks). */
export function nodeRuntimeNotice(version) {
  // Same rule as the backend (semver with prereleases): RC/nightly builds of a newer Node pass,
  // a prerelease of the floor itself comes before it.
  const match = /^v?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/.exec(version)
  if (match) {
    const parts = match.slice(1, 4).map(Number)
    const index = parts.findIndex((part, i) => part !== FLOOR[i])
    if (index === -1 ? !match[4] : parts[index] > FLOOR[index]) return null
  }
  const floor = FLOOR.slice(0, 2).join(".")
  return `Node.js ${version} is older than the supported ${SUPPORTED_NODE_MINIMUM} or could not be read. PkgSteward may fail to start or behave incorrectly; use Node.js ${floor} or newer.`
}
