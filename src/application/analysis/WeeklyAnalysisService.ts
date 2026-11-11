import type { AgentContextService } from '@/application/agent/AgentContextService';
import type { AgentContext } from '@/domain/agent/types';
import type { WeeklyAnalysisResult } from '@/domain/analysis/types';

export type WeeklyAnalysisRequest = {
  context: AgentContext;
  userMessage?: string | null;
};

export interface WeeklyAnalysisGateway {
  analyzeWeekly(request: WeeklyAnalysisRequest): Promise<WeeklyAnalysisResult>;
}

export type AnalyzeCurrentWeekInput = {
  journeyId: string;
  periodId?: string;
  date: string;
  userMessage?: string | null;
};

export class WeeklyAnalysisService {
  constructor(
    private readonly contextService: Pick<AgentContextService, 'build'>,
    private readonly backend: WeeklyAnalysisGateway,
  ) {}

  async analyze(input: AnalyzeCurrentWeekInput): Promise<WeeklyAnalysisResult> {
    const context = await this.contextService.build({
      journeyId: input.journeyId,
      periodId: input.periodId,
      date: input.date,
    });
    return this.backend.analyzeWeekly({
      context,
      userMessage: input.userMessage?.trim() || null,
    });
  }
}
