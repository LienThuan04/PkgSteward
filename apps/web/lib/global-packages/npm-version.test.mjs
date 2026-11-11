import { test } from "node:test"
import assert from "node:assert/strict"
import { npmVersionCard, npmVersionOptions } from "./npm-version.ts"

// TEST data; không phải yêu cầu nghiệp vụ. No package manager or filesystem operations.
const versions = (list, deprecatedVersions = []) => ({ manager: "npm", package: "npm", versions: list, tags: {}, deprecatedVersions })
const npmVersion = (overrides = {}) => ({
  bundledVersion: "11.17.0", overlayVersion: null, terminalVersion: "11.17.0", prefix: "C:\\TEST\\npm",
  overlayState: "absent", delegation: "verified", reason: null, ...overrides,
})
const inventory = (overrides = {}, npm = npmVersion()) => ({
  manager: "npm", version: "11.17.0", available: true, reason: null, globalRoot: "C:\\TEST\\npm\\node_modules",
  binDir: "C:\\TEST\\npm", packages: [], npmVersion: npm, ...overrides,
})

test("version options keep only stable, non-deprecated npm 11 and 12, newest first, current disabled", () => {
  const list = ["10.9.10", "11.0.0", "11.21.2", "12.0.0-pre.1", "12.2.2", "11.17.0", "13.0.0", "12.1.0", "11.20.0+build.1"]
  const options = npmVersionOptions(versions(list, ["12.1.0"]), "11.17.0")
  assert.deepEqual(options, [
    { version: "12.2.2", current: false },
    { version: "11.21.2", current: false },
    { version: "11.17.0", current: true },
    { version: "11.0.0", current: false },
  ])
  assert.deepEqual(list.slice(0, 2), ["10.9.10", "11.0.0"], "registry data is not mutated")
})

test("version options are empty without registry data and tolerate a missing deprecated list", () => {
  assert.deepEqual(npmVersionOptions(null, "11.17.0"), [])
  const legacy = { manager: "npm", package: "npm", versions: ["12.2.2"], tags: {} }
  assert.deepEqual(npmVersionOptions(legacy, null), [{ version: "12.2.2", current: false }])
})

test("card without an overlay offers change only, terminal and app both on the bundled npm", () => {
  const card = npmVersionCard(inventory())
  assert.equal(card.state, "absent")
  assert.equal(card.terminalVersion, "11.17.0")
  assert.equal(card.appVersion, "11.17.0")
  assert.equal(card.prefix, "C:\\TEST\\npm")
  assert.deepEqual([card.canChange, card.canRestore, card.canRepair], [true, false, false])
  assert.equal(card.reason, null)
})

test("card with a working overlay offers change and restore", () => {
  const card = npmVersionCard(inventory({}, npmVersion({ overlayVersion: "12.2.2", terminalVersion: "12.2.2", overlayState: "present" })))
  assert.equal(card.terminalVersion, "12.2.2")
  assert.equal(card.appVersion, "11.17.0")
  assert.deepEqual([card.canChange, card.canRestore, card.canRepair], [true, true, false])
})

test("unverified delegation blocks change but keeps restore available", () => {
  const card = npmVersionCard(inventory({}, npmVersion({ overlayVersion: "12.2.2", terminalVersion: "12.2.2",
    overlayState: "present", delegation: "unverified", reason: "NPM_DELEGATION_UNVERIFIED" })))
  assert.deepEqual([card.canChange, card.canRestore, card.canRepair], [false, true, false])
  assert.equal(card.reason, "NPM_DELEGATION_UNVERIFIED")
})

test("broken overlay offers repair only, even when the npm list failed", () => {
  const card = npmVersionCard(inventory({ available: false, reason: "INVENTORY_FAILED", packages: [] },
    npmVersion({ overlayState: "broken", terminalVersion: null, reason: "INVENTORY_FAILED" })))
  assert.equal(card.state, "broken")
  assert.equal(card.terminalVersion, null)
  assert.deepEqual([card.canChange, card.canRestore, card.canRepair], [false, false, true])
})

test("linked or unsupported layouts allow nothing and keep the server reason", () => {
  for (const [overlayState, reason] of [["linked", "LINKED_PACKAGE"], ["unsupported", "NPM_PREFIX_IS_NODE_DIR"]]) {
    const card = npmVersionCard(inventory({}, npmVersion({ overlayState, reason })))
    assert.deepEqual([card.canChange, card.canRestore, card.canRepair], [false, false, false])
    assert.equal(card.reason, reason)
  }
})

test("no card for pnpm, for a missing npm summary or for an unknown state", () => {
  assert.equal(npmVersionCard(inventory({ manager: "pnpm" })), null)
  assert.equal(npmVersionCard(inventory({ npmVersion: undefined })), null)
  assert.equal(npmVersionCard(inventory({}, npmVersion({ overlayState: "TEST_FUTURE" }))), null)
  assert.equal(npmVersionCard(null), null)
})
