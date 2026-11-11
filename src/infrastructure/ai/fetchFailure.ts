// Native fetch uses TypeError for network failures, but receiver/programming
// errors must remain visible instead of being reported as an offline backend.
export const AI_CONNECTION_HELP = '❌ 无法连接 AI 服务。请确保本地后端已启动，或检查网络代理设置。';

export function isNetworkFetchFailure(error: unknown): boolean {
  return error instanceof TypeError && /failed to fetch|fetch failed|networkerror|network request failed|load failed/i.test(error.message);
}
