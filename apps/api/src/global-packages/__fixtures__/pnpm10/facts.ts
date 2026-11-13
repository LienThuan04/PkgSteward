import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// TEST không phải yêu cầu nghiệp vụ. F5b b1-b9 metadata/list snapshots,
// rebased to TEST paths only. Installed manifests are the observed package bytes.
export interface IF5bStep {
  files: Record<string, string>;
  list: {
    path: string;
    dependencies?: Record<string, { version: string; path: string }>;
  }[];
}
export const f5bStep = (step: number): IF5bStep =>
  JSON.parse(
    readFileSync(join(__dirname, `b${step}.json`), 'utf8'),
  ) as IF5bStep;
export const F5B_MANIFESTS = JSON.parse(
  readFileSync(join(__dirname, 'manifests.json'), 'utf8'),
) as Record<string, string>;
