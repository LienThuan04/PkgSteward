import type { IGlobalPreviewFacts } from '@/global-packages/interfaces/global-packages.runtime';
import type { IGlobalInventoryResult } from '@/global-packages/discovery/global-inventory';
import type { IGlobalPreviewRequest } from '@/global-packages/interfaces/global-packages.types';
import type { IPnpm10DependencyFacts } from '@/global-packages/interfaces/pnpm10-global.types';
import { isDeepStrictEqual } from 'node:util';
import { win32 } from 'node:path';
const key = (path: string) => win32.resolve(path).toLowerCase();
const bins = (value: IPnpm10DependencyFacts['bins']) =>
  [...value]
    .map(({ name, target }) => ({ name, target }))
    .sort((a, b) => a.name.localeCompare(b.name));
const semantic = (d: IPnpm10DependencyFacts) => ({
  name: d.name,
  spec: d.spec,
  version: d.version,
  linked: d.linked,
  realPath: key(d.realPath),
  bins: bins(d.bins),
  shims: [...d.shims]
    .map((s) => ({ path: key(s.file.path), sha256: s.sha256 }))
    .sort((a, b) => a.path.localeCompare(b.path)),
});

export function verifyPnpm10GlobalPostcondition(
  before: IGlobalPreviewFacts,
  after: IGlobalInventoryResult,
  request: Pick<IGlobalPreviewRequest, 'action' | 'package'>,
): boolean {
  const previous = before.pnpm10Inventory,
    current = after.pnpm10Inventory;
  if (
    !previous ||
    !current ||
    !after.ownershipComplete ||
    !current.ownershipComplete
  )
    return false;
  const old = previous.project.dependencies,
    next = current.project.dependencies;
  if (
    new Set(next.map((d) => d.name)).size !== next.length ||
    next.some((d) => !old.some((p) => p.name === d.name))
  )
    return false;
  const targets = old.filter((d) => d.name === request.package);
  if (targets.length !== 1) return false;
  for (const neighbour of old.filter((d) => d.name !== request.package)) {
    const changed = next.filter((d) => d.name === neighbour.name);
    if (
      changed.length !== 1 ||
      !isDeepStrictEqual(semantic(neighbour), semantic(changed[0]))
    )
      return false;
  }
  const target = next.filter((d) => d.name === request.package);
  const row = after.packages.filter((d) => d.name === request.package);
  if (request.action === 'remove') {
    if (
      target.length ||
      row.length ||
      after.facts.some((d) => d.name === request.package)
    )
      return false;
  } else if (request.action === 'change') {
    const exact = before.target;
    const installed = after.facts.filter((d) => d.name === request.package);
    if (
      !exact ||
      target.length !== 1 ||
      row.length !== 1 ||
      row[0].status !== 'manageable' ||
      installed.length !== 1 ||
      installed[0].version !== exact.version ||
      !target[0].manifest ||
      target[0].linked ||
      target[0].spec !== exact.version ||
      target[0].version !== exact.version ||
      row[0].version !== exact.version ||
      !isDeepStrictEqual(bins(target[0].bins), bins(exact.bins)) ||
      !isDeepStrictEqual(bins(row[0].bins), bins(exact.bins)) ||
      !isDeepStrictEqual(bins(installed[0].bins), bins(exact.bins))
    )
      return false;
    for (const bin of target[0].bins) {
      for (const ext of ['', '.cmd', '.ps1']) {
        const slot = current.binSlots.find(
          (s) => s.name.toLowerCase() === `${bin.name}${ext}`.toLowerCase(),
        );
        if (
          !slot ||
          slot.owner !== request.package ||
          !slot.sha256 ||
          !target[0].shims.some(
            (s) =>
              key(s.file.path) === key(slot.identity.path) &&
              s.sha256 === slot.sha256,
          )
        )
          return false;
      }
    }
  } else return false;
  const remaining = new Set(
    target[0]?.bins.map((b) => b.name.toLowerCase()) ?? [],
  );
  const retired = new Set(
    targets[0].bins
      .filter((b) => !remaining.has(b.name.toLowerCase()))
      .map((b) => b.name.toLowerCase()),
  );
  if (
    current.binSlots.some((s) =>
      retired.has(
        s.name.toLowerCase().replace(/\.(?:cmd|ps1|exe|bat|com)$/i, ''),
      ),
    )
  )
    return false;
  return true;
}
