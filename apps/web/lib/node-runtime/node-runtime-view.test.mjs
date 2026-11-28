import assert from "node:assert/strict"
import { test } from "node:test"

import { createNavigationStore } from "../ui/navigation-store.ts"
import { makeViewStateKey } from "../ui/navigation-targets.ts"
import {
  countNodeProjectsByStatus,
  filterAndSortNodeProjects,
  NODE_RUNTIME_DISCOVERY,
  nodeRuntimeDiscoveryCodec,
  pickPrimaryCommand,
} from "./node-runtime-view.ts"

test("Node Runtime restores the same filter and result order after returning to the list", () => {
  const key = makeViewStateKey("node-runtime-list")
  const store = createNavigationStore()
  store.hydrate()
  store.setActiveNavigation("overview", "/node-runtime")
  assert.equal(store.readViewState(key, nodeRuntimeDiscoveryCodec), null)
  assert.deepEqual(NODE_RUNTIME_DISCOVERY, { query: "", statuses: [], sort: "priority" })

  const selection = { query: "TEST", statuses: ["compatible", "undeclared"], sort: "name" }
  store.writeViewState(key, nodeRuntimeDiscoveryCodec, selection)
  store.setActiveNavigation("detail", "/projects?path=D%3A%5CTEST%5Cbeta-mismatch")
  store.setActiveNavigation("return", "/node-runtime")

  const restored = store.readViewState(key, nodeRuntimeDiscoveryCodec)
  assert.deepEqual(restored, selection)
  assert.deepEqual(filterAndSortNodeProjects(sampleProjects, restored).map(project => project.name), [
    "alpha-undeclared",
    "zebra-compatible",
  ])
  store.clearViewState(key)
  assert.equal(store.readViewState(key, nodeRuntimeDiscoveryCodec), null)
})

test("Node Runtime discovery state rejects invalid or unrelated fields", () => {
  for (const invalid of [
    { ...NODE_RUNTIME_DISCOVERY, query: "q".repeat(513) },
    { ...NODE_RUNTIME_DISCOVERY, statuses: ["compatible", "compatible"] },
    { ...NODE_RUNTIME_DISCOVERY, statuses: ["invalid"] },
    { ...NODE_RUNTIME_DISCOVERY, sort: "activity" },
    { ...NODE_RUNTIME_DISCOVERY, project: sampleProjects[0] },
  ]) {
    assert.equal(nodeRuntimeDiscoveryCodec.decode(invalid), null)
  }
})

// TEST data; not business requirements.
const sampleProjects = [
  {
    path: "D:\\TEST\\zebra-compatible",
    name: "zebra-compatible",
    status: "compatible",
    activeNodeVersion: "24.19.0",
    effectiveRequirement: {
      source: "package.json#engines.node",
      raw: ">=22.18",
      normalizedRange: ">=22.18.0",
      suggestedVersion: "22.18.0",
    },
    requirements: [
      {
        source: "package.json#engines.node",
        raw: ">=22.18",
        normalizedRange: ">=22.18.0",
        suggestedVersion: "22.18.0",
      },
    ],
    matchedInstalledVersion: "24.19.0",
    suggestedVersion: "24.19.0",
    commands: [],
  },
  {
    path: "D:\\TEST\\alpha-undeclared",
    name: "alpha-undeclared",
    status: "undeclared",
    activeNodeVersion: "24.19.0",
    effectiveRequirement: null,
    requirements: [],
    matchedInstalledVersion: null,
    suggestedVersion: null,
    commands: [],
  },
  {
    path: "D:\\TEST\\beta-mismatch",
    name: "beta-mismatch",
    status: "mismatch",
    activeNodeVersion: "24.19.0",
    effectiveRequirement: {
      source: ".nvmrc",
      raw: "20.18.1",
      normalizedRange: "20.18.1",
      suggestedVersion: "20.18.1",
    },
    requirements: [
      {
        source: ".nvmrc",
        raw: "20.18.1",
        normalizedRange: "20.18.1",
        suggestedVersion: "20.18.1",
      },
    ],
    matchedInstalledVersion: "20.18.1",
    suggestedVersion: "20.18.1",
    commands: [
      {
        managerId: "volta",
        managerLabel: "Volta",
        targetVersion: "20.18.1",
        alreadyInstalled: false,
        installCommand: "volta install node@20.18.1",
        switchCommand: "volta pin node@20.18.1",
      },
      {
        managerId: "nvm-windows",
        managerLabel: "nvm-windows",
        targetVersion: "20.18.1",
        alreadyInstalled: true,
        installCommand: null,
        switchCommand: "nvm use 20.18.1",
      },
    ],
  },
  {
    path: "D:\\TEST\\gamma-unknown",
    name: null,
    status: "unknown",
    activeNodeVersion: "24.19.0",
    effectiveRequirement: {
      source: ".nvmrc",
      raw: "lts/iron",
      normalizedRange: null,
      suggestedVersion: null,
    },
    requirements: [
      {
        source: ".nvmrc",
        raw: "lts/iron",
        normalizedRange: null,
        suggestedVersion: null,
      },
    ],
    matchedInstalledVersion: null,
    suggestedVersion: null,
    commands: [],
  },
]

test("countNodeProjectsByStatus counts every compatibility status accurately", () => {
  assert.deepEqual(countNodeProjectsByStatus(sampleProjects), {
    total: 4,
    compatible: 1,
    mismatch: 1,
    unknown: 1,
    undeclared: 1,
  })
})

test("filterAndSortNodeProjects orders mismatch -> unknown -> compatible -> undeclared in priority sort", () => {
  const ordered = filterAndSortNodeProjects(sampleProjects, {
    query: "",
    statuses: [],
    sort: "priority",
  })

  assert.deepEqual(
    ordered.map((item) => item.status),
    ["mismatch", "unknown", "compatible", "undeclared"],
  )
})

test("filterAndSortNodeProjects supports name sort, status filter, and requirement search", () => {
  const byName = filterAndSortNodeProjects(sampleProjects, {
    query: "",
    statuses: [],
    sort: "name",
  })
  assert.deepEqual(
    byName.map((item) => item.name ?? item.path),
    ["alpha-undeclared", "beta-mismatch", "D:\\TEST\\gamma-unknown", "zebra-compatible"],
  )

  const filteredByRaw = filterAndSortNodeProjects(sampleProjects, {
    query: "lts/iron",
    statuses: ["unknown"],
    sort: "priority",
  })
  assert.deepEqual(
    filteredByRaw.map((item) => item.path),
    ["D:\\TEST\\gamma-unknown"],
  )
})

test("filterAndSortNodeProjects normalizes Unicode and whitespace in searchable fields", () => {
  const project = {
    ...sampleProjects[0],
    name: "Dự án mẫu",
    path: "D:\\TEST\\Thư  mục",
    requirements: [{ ...sampleProjects[0].requirements[0], raw: ">=22   <25" }],
  }
  const projects = [...sampleProjects, project]

  for (const query of [
    "  DỰ   ÁN MẪU  ".normalize("NFD"),
    "THƯ mục".normalize("NFD"),
    ">=22 <25",
  ]) {
    assert.deepEqual(filterAndSortNodeProjects(projects, {
      query,
      statuses: ["compatible"],
      sort: "name",
    }), [project], query)
  }
})

test("pickPrimaryCommand prioritizes nvm-windows -> fnm -> volta and returns null when empty", () => {
  assert.equal(pickPrimaryCommand([]), null)
  const picked = pickPrimaryCommand(sampleProjects[2].commands)
  assert.equal(picked?.managerId, "nvm-windows")
  assert.equal(picked?.switchCommand, "nvm use 20.18.1")
})
