import 'reflect-metadata';
import { pnpm10InventoryFixture } from '../__fixtures__/pnpm10/inventory';
import { readPnpm10GlobalInventory } from '../discovery/pnpm10-global-inventory';
import { expectGlobalReason } from '../__fixtures__/global-adapters';
import { assertPnpm10GlobalMutable } from './pnpm10-global-policy';

describe('pnpm 10 shared project policy', () => {
  async function setup() {
    const h = await pnpm10InventoryFixture(6);
    const inventory = await readPnpm10GlobalInventory(h.location, h.deps);
    return {
      location: h.location,
      inventory,
      packageName: 'semver',
      action: 'change' as const,
    };
  }
  it('permits registry targets with linked and registry neighbours', async () => {
    const input = await setup();
    expect(() => assertPnpm10GlobalMutable(input)).not.toThrow();
  });
  it.each(['package', 'bin', 'path', 'node'])(
    'protects neighbour %s',
    async (kind) => {
      const input = await setup();
      const neighbour =
        input.inventory.pnpm10Inventory!.project.dependencies.find(
          (d) => d.name !== 'semver',
        )!;
      if (kind === 'package') neighbour.name = 'pnpm';
      if (kind === 'bin') neighbour.bins = [{ name: 'node', target: 'cli.js' }];
      if (kind === 'path')
        neighbour.realPath = input.location.protectedPaths[0];
      if (kind === 'node')
        neighbour.realPath = input.location.tool.file.replace(
          /\\[^\\]+$/,
          '\\TEST-neighbour',
        );
      await expectGlobalReason(
        () => assertPnpm10GlobalMutable(input),
        'PROTECTED_PACKAGE',
      );
    },
  );
  it('refuses invalid neighbours and incomplete ownership', async () => {
    const input = await setup();
    input.inventory.packages.find((d) => d.name !== 'semver')!.status =
      'invalid';
    await expectGlobalReason(
      () => assertPnpm10GlobalMutable(input),
      'INVENTORY_FAILED',
    );
    input.inventory.ownershipComplete = false;
    await expectGlobalReason(
      () => assertPnpm10GlobalMutable(input),
      'INVENTORY_FAILED',
    );
  });
  it('evaluates every neighbour registry scope for change, while remove stays offline', async () => {
    const input = await setup();
    input.location.pnpm10.policy.scopedRegistries = ['@tootallnate'];
    await expectGlobalReason(
      () => assertPnpm10GlobalMutable(input),
      'REGISTRY_CONFIG_UNSUPPORTED',
    );
    expect(() =>
      assertPnpm10GlobalMutable({ ...input, action: 'remove' }),
    ).not.toThrow();
  });
});
