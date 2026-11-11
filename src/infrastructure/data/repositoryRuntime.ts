import { createId } from '@/shared/id';

// Seed-only injection; interactive repositories keep the real clock and UUIDs.
export type RepositoryRuntime = { now: () => Date; createId: (prefix: string) => string };
export const repositoryRuntime: RepositoryRuntime = { now: () => new Date(), createId };
