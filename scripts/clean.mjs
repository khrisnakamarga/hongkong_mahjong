import { rm } from 'node:fs/promises';

const paths = [
  'coverage',
  'playwright-report',
  'test-results',
  'packages/game-engine/dist',
  'apps/server/dist',
  'apps/client/dist',
  'packages/game-engine/tsconfig.tsbuildinfo',
  'apps/server/tsconfig.tsbuildinfo'
];

await Promise.all(paths.map((path) => rm(path, { recursive: true, force: true })));