import type { Task } from '@/domain/tasks/types';

/** Narrow workflow dispatch, not a general-purpose chat/intent API. IDs always come from local facts. */
export function schedulingTaskMatches<T extends Pick<Task, 'id' | 'title'>>(text: string, tasks: T[]): T[] {
  const normalized = text.replace(/\s/g, '');
  return tasks.filter(task => task.title.trim() && normalized.includes(task.title.replace(/\s/g, '')));
}
export function isSchedulingInput(text: string) {
  return /下(?:个)?(?:周|星期|礼拜)[一二三四五六日天].+|安排|排程|新建.*任务|(?:今天|明天|后天)(?:上午|下午|晚上|早上|中午|\d|[一二三四五六七八九十两]+点)/.test(text);
}

/** Display input encoded as an existing message preference, not a new API field or authority. */
export function withDurationPreference(text: string, input: string) {
  if (!input.trim()) return text.trim();
  const minutes = Number(input);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) throw new Error('预计时长请填写 1–240 的整数分钟，或留空');
  const message = text.trim().replace(/[。！!]+$/, '');
  const shortDate = /^(今天|明天|后天)(上午|早上|中午|下午|晚上)$/.test(message);
  const result = `${message}${shortDate ? '安排' : ''}（预计用时${minutes}分钟）`;
  if (result.length > 2000) throw new Error('消息与时长合计不能超过 2000 字，请缩短消息');
  return result;
}
