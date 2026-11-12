// JS thuần, không import .ts: phải chạy được cả trên Node quá cũ để còn in cảnh báo.
const FLOOR = [22, 18, 0]

/** English warning for an unsupported Node.js version, or null when it is supported (never blocks). */
export function nodeRuntimeNotice(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (match) {
    const parts = match.slice(1).map(Number)
    const index = parts.findIndex((part, i) => part !== FLOOR[i])
    if (index === -1 || parts[index] > FLOOR[index]) return null
  }
  return `Node.js ${version} is older than the supported 22.18.0 or could not be read. PkgSteward may fail to start or behave incorrectly; use Node.js 22.18 or newer.`
}
