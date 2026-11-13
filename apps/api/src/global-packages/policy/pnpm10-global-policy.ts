import type { IGlobalResolvedLocation } from '../interfaces/global-packages.runtime';
import type { IGlobalInventoryResult } from '../discovery/global-inventory';
import type { GlobalAction } from '../interfaces/global-packages.types';
import { AppException } from '@/common/exceptions/app.exception';
import { win32 } from 'node:path';
import { assertGlobalPackageMutable } from './global-policy';
import { assessPnpmGlobalRegistryPolicy } from '../config/pnpm-global-config';
export interface IPnpm10MutationPolicyInput {
  location: IGlobalResolvedLocation;
  inventory: IGlobalInventoryResult;
  packageName: string;
  action: GlobalAction;
}
const fail = (reason: string): never => {
  throw new AppException(
    409,
    'pnpm 10 shared project is not mutable',
    'CONFLICT',
    { reason },
  );
};
export function assertPnpm10GlobalMutable(
  input: IPnpm10MutationPolicyInput,
): void {
  const { location, inventory, packageName, action } = input;
  const config = location.pnpm10,
    facts = inventory.pnpm10Inventory;
  if (
    !config ||
    !facts ||
    !facts.project.storeDir ||
    inventory.packages.some((r) => r.status === 'invalid') ||
    inventory.packages.length !== facts.project.dependencies.length
  )
    return fail('INVENTORY_FAILED');
  const target = inventory.packages.filter((r) => r.name === packageName);
  if (target.length !== 1 || target[0].status !== 'manageable')
    return fail(target[0]?.reason ?? 'INVENTORY_FAILED');
  if (!inventory.ownershipComplete || !facts.ownershipComplete)
    return fail('BIN_CONFLICT');
  const protectedPaths = [
    ...location.protectedPaths,
    win32.dirname(location.tool.file),
  ];
  for (const dependency of facts.project.dependencies) {
    // Linked neighbours are permitted, but neither their path nor bins may be
    // protected. Pass linked=false only for this protection check; the target
    // must still be a proven, mutable registry row above.
    for (const packageRoot of [dependency.logicalPath, dependency.realPath]) {
      assertGlobalPackageMutable({
        packageName: dependency.name,
        packageRoot,
        linked: false,
        currentBins: dependency.bins,
        targetBins: [],
        binOwners: [],
        ownershipComplete: true,
        protectedPaths,
      });
    }
    if (
      action === 'change' &&
      !assessPnpmGlobalRegistryPolicy({
        packageName: dependency.name,
        action,
        configs: [],
        environment: {},
        provenanceKnown: true,
        pnpmPolicies: [config.policy],
      }).changeAllowed
    )
      return fail('REGISTRY_CONFIG_UNSUPPORTED');
  }
}
