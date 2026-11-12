import { test } from "node:test"
import assert from "node:assert/strict"
import { nodeRuntimeNotice, SUPPORTED_NODE_MINIMUM } from "./node-runtime.mjs"

test("pins the officially supported Node minimum", () => {
  assert.equal(SUPPORTED_NODE_MINIMUM, "22.18.0")
})

for (const version of ["20.20.2", "22.12.0", "22.17.1", "22.18.0-pre", ""]) {
  test(`warns for Node ${JSON.stringify(version)} and names the floor`, () => {
    const notice = nodeRuntimeNotice(version)
    assert.equal(typeof notice, "string")
    assert.match(notice, /22\.18/)
    if (version) assert.ok(notice.includes(version))
  })
}

for (const version of ["22.18.0", "22.23.5", "v22.18.0", "24.19.0", "24.0.0-rc.1", "26.0.0-nightly20261101abcdef"]) {
  test(`stays silent on Node ${version}`, () => {
    assert.equal(nodeRuntimeNotice(version), null)
  })
}
