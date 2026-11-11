import { newestGlobalVersions } from "./global-version-options.ts"
import type {
  GlobalManagerInventory, GlobalNpmVersion, GlobalReasonCode, GlobalVersions, NpmOverlayState,
} from "@/lib/global-packages/global-types"

export interface NpmVersionOption { version: string; current: boolean }
export interface NpmVersionCardModel {
  state: NpmOverlayState
  terminalVersion: string | null
  appVersion: string
  prefix: string
  delegation: GlobalNpmVersion["delegation"]
  reason: GlobalReasonCode | null
  canChange: boolean
  canRestore: boolean
  canRepair: boolean
}

// Chỉ npm 11/12 bản ổn định (U-81). Backend vẫn kiểm tra lại engines/deprecated khi preview.
const SUPPORTED_TARGET = /^(?:11|12)\.\d+\.\d+$/
const STATES: readonly NpmOverlayState[] = ["absent", "present", "broken", "linked", "unsupported"]

export function npmVersionOptions(versions: GlobalVersions | null, current: string | null): NpmVersionOption[] {
  if (!versions) return []
  const deprecated = new Set(versions.deprecatedVersions ?? [])
  const supported = [...new Set(versions.versions)].filter(version => SUPPORTED_TARGET.test(version) && !deprecated.has(version))
  return newestGlobalVersions(supported).map(version => ({ version, current: version === current }))
}

export function npmVersionCard(inventory: GlobalManagerInventory | null): NpmVersionCardModel | null {
  const npm = inventory?.manager === "npm" ? inventory.npmVersion : undefined
  if (!npm || !STATES.includes(npm.overlayState)) return null
  const state = npm.overlayState
  return {
    state,
    terminalVersion: npm.terminalVersion,
    appVersion: npm.bundledVersion,
    prefix: npm.prefix,
    delegation: npm.delegation,
    reason: npm.reason,
    // Đổi cần chứng minh được terminal sẽ chạy overlay; quay về/sửa không phụ thuộc điều đó.
    canChange: (state === "absent" || state === "present") && npm.delegation === "verified",
    canRestore: state === "present",
    canRepair: state === "broken",
  }
}
