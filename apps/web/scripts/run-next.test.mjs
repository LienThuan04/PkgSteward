import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const frontendDirectory = fileURLToPath(new URL("../", import.meta.url))
const scriptPath = fileURLToPath(new URL("./run-next.mjs", import.meta.url))

const run = (mode, overrides, nodeArgs = []) => spawnSync(process.execPath, [...nodeArgs, scriptPath, mode], {
  cwd: frontendDirectory,
  env: { ...process.env, PORT: "3500", HOST: "127.0.0.1", ...overrides },
  encoding: "utf8",
  shell: false,
  timeout: 5000,
})

test("invalid PORT exits unsuccessfully with a PORT error before starting Next", () => {
  const result = run("dev", { PORT: "abc" })
  assert.equal(result.error, undefined)
  assert.equal(result.signal, null)
  assert.ok(Number.isInteger(result.status))
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /PORT/)
})

test("non-loopback HOST exits unsuccessfully with a HOST error before starting Next", () => {
  const result = run("dev", { HOST: "0.0.0.0" })
  assert.equal(result.error, undefined)
  assert.equal(result.signal, null)
  assert.ok(Number.isInteger(result.status))
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /HOST/)
})

test("unsupported build mode exits unsuccessfully with a mode error", () => {
  const result = run("build", { PORT: "abc" })
  assert.equal(result.error, undefined)
  assert.equal(result.signal, null)
  assert.ok(Number.isInteger(result.status))
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /build/)
})

for (const mode of ["dev", "start"]) {
  test(`${mode} validates PORT without native TypeScript loading`, () => {
    const result = run(mode, { PORT: "abc" }, ["--no-experimental-strip-types"])
    assert.equal(result.error, undefined)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /PORT must be an integer/)
    assert.doesNotMatch(result.stderr, /Unknown file extension|ERR_UNKNOWN_FILE_EXTENSION/)
  })

  test(`${mode} validates loopback HOST without native TypeScript loading`, () => {
    const result = run(mode, { HOST: "0.0.0.0" }, ["--no-experimental-strip-types"])
    assert.equal(result.error, undefined)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /HOST must be 127\.0\.0\.1, localhost or ::1/)
    assert.doesNotMatch(result.stderr, /Unknown file extension|ERR_UNKNOWN_FILE_EXTENSION/)
  })
}
