import { test } from "node:test"
import assert from "node:assert/strict"
import { nodeRuntimeNotice } from "./node-runtime.mjs"

for (const version of ["20.20.2", "22.12.0", "22.17.1", "v22.18.0", ""]) {
  test(`warns for Node ${JSON.stringify(version)} and names the floor`, () => {
    const notice = nodeRuntimeNotice(version)
    assert.equal(typeof notice, "string")
    assert.match(notice, /22\.18/)
    if (version) assert.ok(notice.includes(version))
  })
}

for (const version of ["22.18.0", "22.23.5", "24.19.0", "26.0.0"]) {
  test(`stays silent on Node ${version}`, () => {
    assert.equal(nodeRuntimeNotice(version), null)
  })
}
