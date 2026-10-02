// The tests run the real engine, not a copy of it.  Node's built-in TypeScript
// type-stripping loads src/sync.ts directly.
export { SyncEngine } from '../src/sync.ts'

import { SyncEngine } from '../src/sync.ts'

export const createSyncEngine = (data) => new SyncEngine(data)
