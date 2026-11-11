// Hold one demo session per origin, including the entire interactive Agent flow.
// A second tab must not execute an old approved proposal after another tab resets.
export function acquireDemoSession(): Promise<() => Promise<void>> {
  if (typeof navigator === 'undefined' || !navigator.locks) {
    return Promise.reject(new Error('此浏览器不支持安全的 Demo 会话锁。请使用支持 Web Locks 的浏览器；个人数据仍可使用。'));
  }
  return new Promise((resolve, reject) => {
    const request = navigator.locks.request('growai-demo-session', { ifAvailable: true }, async (lock) => {
      if (!lock) { reject(new Error('其他标签页正在使用 Demo，请先退出该标签页的演示模式。')); return; }
      await new Promise<void>((release) => resolve(async () => {
        release();
        // Resolving the callback is not the same as the browser releasing the lock.
        await request;
      }));
    });
    void request.catch(reject);
  });
}
