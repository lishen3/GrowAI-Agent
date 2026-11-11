import type { ConversationMessage } from '@/domain/agent/conversation';

/** Missing a terminal reply is uncertainty, never permission to replay a request. */
export function hasUnconfirmedRequests(messages: ConversationMessage[]): boolean {
  const completed = new Set(messages.filter(row => ['complete', 'failed', 'cancelled'].includes(row.status)).map(row => row.requestId));
  return messages.some(row => row.status === 'pending' && row.requestId && !completed.has(row.requestId));
}
