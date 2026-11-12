// Nạp đầu tiên trong main.ts: Node quá cũ có thể chết ngay khi nạp AppModule (execa cần Node 22),
// nên cảnh báo phải in ra trước mọi import khác.
import { nodeRuntimeNotice } from '@/config/node-runtime';

const notice = nodeRuntimeNotice(process.versions.node);
if (notice) console.warn(`[PkgSteward] ${notice}`);
