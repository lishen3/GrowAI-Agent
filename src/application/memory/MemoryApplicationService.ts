import { createMemorySchema, selectRelevantMemories, type CreateMemoryInput, type Memory } from '@/domain/memory/types';

export interface MemoryGateway {
  createMemory(input: CreateMemoryInput): Promise<Memory>;
  listMemories(journeyId: string): Promise<Memory[]>;
  archiveMemory(journeyId: string, memoryId: string): Promise<Memory>;
}

export class MemoryApplicationService {
  constructor(private readonly gateway: MemoryGateway) {}

  createMemory(input: CreateMemoryInput): Promise<Memory> {
    return this.gateway.createMemory(createMemorySchema.parse(input));
  }

  listMemories(journeyId: string): Promise<Memory[]> { return this.gateway.listMemories(journeyId); }

  archiveMemory(journeyId: string, memoryId: string): Promise<Memory> {
    return this.gateway.archiveMemory(journeyId, memoryId);
  }

  async listRelevantMemories(journeyId: string): Promise<Memory[]> {
    return selectRelevantMemories(await this.listMemories(journeyId), journeyId);
  }
}
