import {
  createGlobalPreview,
  assertGlobalPreviewUnchanged,
  snapshotGlobalPreviewFacts,
  validateGlobalConfirmation,
  GlobalPreviewStore,
} from './global-preview';
import {
  npmEntry,
  npmPresent,
  npmSelfFacts,
  npmTarget,
} from '../__fixtures__/npm-overlay/facts';
import {
  testFacts,
  testClock,
  testConsent,
  testRequest,
  TEST_PREVIEW_ID,
} from '../__fixtures__/global-lifecycle';
import type { IGlobalPreviewFacts } from '../interfaces/global-packages.runtime';

// TEST không phải yêu cầu nghiệp vụ. Only injected inert facts.
const facts = (): IGlobalPreviewFacts => {
  const base = testFacts();
  base.location.prefix = 'D:\\TEST\\prefix';
  base.location.binDir = 'D:\\TEST\\prefix';
  base.location.globalRoot = 'D:\\TEST\\prefix\\node_modules';
  return { ...base, current: null, target: npmTarget(), npm: npmSelfFacts() };
};
const preview = (
  input: IGlobalPreviewFacts,
  action: 'change' | 'remove' | 'repair' = 'change',
) =>
  createGlobalPreview(
    TEST_PREVIEW_ID,
    testRequest({
      package: 'npm',
      action,
      ...(action === 'change' ? { targetVersion: 'latest' } : {}),
    }),
    input,
    testClock().now(),
  );

describe('npm-self previews and retained facts', () => {
  it('previews an absent overlay with bundled terminal current and shared confirmation', () => {
    const input = facts();
    const result = preview(input);
    expect(result).toMatchObject({
      currentVersion: '11.17.0',
      targetVersion: '12.2.2',
      confirmText: 'CHANGE GLOBAL npm npm TO 12.2.2',
      npm: {
        appVersion: '11.17.0',
        terminalBefore: '11.17.0',
        terminalAfter: '12.2.2',
        prefix: 'D:\\TEST\\prefix',
        repairTargets: [],
      },
    });
    expect(result.warningCodes).toContain('TERMINAL_NPM_SWITCH');
    expect(input.current).toBeNull();
    expect(() =>
      validateGlobalConfirmation(
        result,
        testConsent({ confirmText: result.confirmText }),
      ),
    ).not.toThrow();
  });
  it('restores overlay equal to bundled without a version change refusal', () => {
    const input = facts();
    input.npm = npmPresent('11.17.0');
    input.current = input.npm.overlay!.package;
    input.target = null;
    const result = preview(input, 'remove');
    expect(result.confirmText).toBe('REMOVE GLOBAL npm npm');
    expect(result.warningCodes).not.toContain('MAJOR_VERSION_CHANGE');
    expect(result.warningCodes).not.toContain('VERSION_DOWNGRADE');
    expect(result.npm?.terminalAfter).toBe('11.17.0');
  });
  it('repairs broken state with null current and exact target paths', () => {
    const input = facts();
    input.target = null;
    input.npm!.shims[0].entry = npmEntry('D:\\TEST\\prefix\\npm');
    const result = preview(input, 'repair');
    expect(result).toMatchObject({
      currentVersion: null,
      confirmText: 'REPAIR GLOBAL npm npm',
      npm: {
        terminalBefore: null,
        terminalAfter: '11.17.0',
        repairTargets: ['D:\\TEST\\prefix\\npm'],
      },
    });
    expect(() =>
      validateGlobalConfirmation(
        result,
        testConsent({ confirmText: result.confirmText }),
      ),
    ).not.toThrow();
    expect(() =>
      validateGlobalConfirmation(
        result,
        testConsent({ confirmText: 'REMOVE GLOBAL npm npm' }),
      ),
    ).toThrow();
  });
  it('snapshots method-bearing file identities without sharing caller objects', () => {
    const input = facts();
    const store = new GlobalPreviewStore(testClock());
    store.put(preview(input), input);
    input.npm!.nodeDirShims[0].entry!.sha256 = 'changed';
    expect(
      store.get(TEST_PREVIEW_ID).facts.npm!.nodeDirShims[0].entry!.sha256,
    ).not.toBe('changed');
  });
  it.each([
    'bundled',
    'node-shim-hash',
    'node-shim-identity',
    'prefix-script',
    'overlay',
    'S',
    'retired',
    'target',
    'repair',
    'prefix-directory',
    'root-directory',
  ])('invalidates changed %s facts', (change) => {
    const input = facts();
    const retained = snapshotGlobalPreviewFacts(input);
    const npm = input.npm!;
    if (change === 'bundled') npm.bundledIdentities[0].sha256 = 'new';
    if (change === 'node-shim-hash') npm.nodeDirShims[0].entry!.sha256 = 'new';
    if (change === 'node-shim-identity')
      npm.nodeDirShims[0].entry!.identity.stat.ino = 55;
    if (change === 'prefix-script') npm.prefixScript!.file.stat.ino = 66;
    if (change === 'overlay') npm.overlay = npmPresent().overlay;
    if (change === 'S') npm.shims[0].entry = npmEntry('D:\\TEST\\prefix\\npm');
    if (change === 'retired')
      npm.retired = [npmEntry('D:\\TEST\\prefix\\.npm-any')];
    if (change === 'target') input.target!.manifestHash = 'new';
    if (change === 'repair')
      npm.repairTargets = [npmEntry('D:\\TEST\\prefix\\npm')];
    if (change === 'prefix-directory')
      npm.prefixDirectory.identity.stat.ino = 88;
    if (change === 'root-directory') npm.rootDirectory.identity.stat.dev = 88;
    expect(() => assertGlobalPreviewUnchanged(retained, input)).toThrow();
  });
  it('refuses npm facts attached to another manager or package and invalid repair selectors', () => {
    const input = facts();
    expect(() =>
      createGlobalPreview(
        TEST_PREVIEW_ID,
        testRequest({ action: 'repair', package: 'test-tool' }),
        input,
        testClock().now(),
      ),
    ).toThrow();
    expect(() =>
      createGlobalPreview(
        TEST_PREVIEW_ID,
        testRequest({ action: 'repair', manager: 'pnpm', package: 'npm' }),
        input,
        testClock().now(),
      ),
    ).toThrow();
    expect(() =>
      createGlobalPreview(
        TEST_PREVIEW_ID,
        testRequest({
          action: 'change',
          package: 'test-tool',
          targetVersion: 'latest',
        }),
        input,
        testClock().now(),
      ),
    ).toThrow();
  });
  it('compares directory identity by dev/ino/type, ignoring directory timestamp and size', () => {
    const input = facts();
    input.npm = npmPresent();
    const retained = snapshotGlobalPreviewFacts(input);
    const directory = input.npm.overlay!.directory.identity.stat;
    directory.size += 100;
    directory.mtimeMs += 100;
    directory.ctimeMs += 100;
    expect(() => assertGlobalPreviewUnchanged(retained, input)).not.toThrow();
    directory.ino = 99;
    expect(() => assertGlobalPreviewUnchanged(retained, input)).toThrow();
  });
});
