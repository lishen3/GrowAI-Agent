import { expect, test } from '@playwright/test';

test.use({ timezoneId: 'Asia/Shanghai', viewport: { width: 390, height: 844 } });

test.beforeEach(async ({ page, context }) => {
  const origin = 'http://localhost:8081';
  await context.route('**/*', route => new URL(route.request().url()).origin === origin
    ? route.continue() : route.abort());
  await page.clock.setFixedTime(new Date('2026-11-10T16:30:00Z'));
  await page.goto(origin + '/period');
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  await button('＋ 新建').click();
  await page.getByLabel('阶段名称').fill('智能体验收');
  await page.getByLabel('开始日期').fill('2026-11-09');
  await page.getByLabel('结束日期').fill('2026-12-01');
  await button('保存阶段').click();
  const period = page.getByRole('button', { name: /智能体验收/ });
  await period.click();
  await expect(period.getByText('当前', { exact: true })).toBeVisible();
  await page.goto(origin + '/coach');
});

test('coach separates shortcut text and drafts between conversations', async ({ page }) => {
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  const choose = async (name: string) => {
    await button('更多选项').click();
    await page.getByRole('radio', {name, exact:true}).click();
  };
  await choose('查看本周状态');
  await expect(page.getByText(/系统事实 ·/)).toBeVisible();
  await choose('本周复盘');
  await choose('安排任务');
  const message = page.getByRole('textbox', { name: '消息', exact: true });
  await expect.soft(message).toHaveValue('');
  await message.fill('明天下午阅读');
  await button('更多选项').click();
  await page.getByPlaceholder('例如 30，留空则不指定').fill('40');
  await button('历史记录').click();
  await expect.soft(page.getByText(/当前对话$/)).toContainText('00:30');
  await button('新建对话').click();
  await expect(page.getByText('当前阶段 · 智能体验收')).toBeVisible();
  await expect.soft(message).toHaveValue('');
  await choose('安排任务');
  await button('更多选项').click();
  await expect(page.getByPlaceholder('例如 30，留空则不指定')).toHaveValue('');
});

test('a proposed task reaches the calendar exactly once after confirmation', async ({ page }) => {
  let requests = 0;
  const title = '合成阅读练习';
  await page.route('**/api/v1/replan/time/create-and-schedule', route => {
    requests++;
    return route.fulfill({ json: {
      action: 'CREATE_AND_SCHEDULE', taskTitle: title, reason: '符合下午空档',
      date: '2026-11-11', startTime: '14:00', endTime: '14:30',
      createdAt: '2026-11-10T16:30:00Z', expiresAt: '2026-11-10T16:45:00Z', proposalId: 'review-proposal',
    } });
  });
  const counts = () => page.evaluate(async title => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('growai-pwa');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      return await Promise.all(['tasks', 'scheduleEvents'].map(name => new Promise<number>((resolve, reject) => {
        const r = db.transaction(name).objectStore(name).getAll();
        r.onsuccess = () => resolve(r.result.filter(row => row.title === title).length);
        r.onerror = () => reject(r.error);
      })));
    } finally { db.close(); }
  }, title);
  await page.getByRole('textbox', { name: '消息' }).fill('今天下午安排合成阅读练习');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  const confirm = page.getByRole('button', { name: '确认并添加', exact: true });
  await expect(confirm).toBeEnabled();
  expect(await counts()).toEqual([0, 0]);
  await confirm.dblclick();
  await expect.poll(counts).toEqual([1, 1]);
  await page.reload();
  await expect(page.getByRole('button', { name: '查看当天日历', exact: true })).toBeVisible();
  expect(await counts()).toEqual([1, 1]);
  expect(requests).toBe(1);
  await page.getByRole('button', {name:'查看当天日历'}).click();
  await expect(page).toHaveURL(/\/plan/);
  await expect(page.getByText(/2026-11-11 14:00–14:30/).last()).toBeVisible();
});

test('new task duration and failed request drafts stay under user control', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/v1/replan/time/create-and-schedule', route => {
    calls++;
    return route.fulfill({ status: 503, json: { detail: { message: '服务繁忙' } } });
  });
  const input = page.getByRole('textbox', { name: '消息', exact: true });
  const send = page.getByRole('button', { name: '发送', exact: true });
  await input.fill('下周三练听力25分钟');
  await expect(send).toBeDisabled();
  await expect(page.getByText(/新建任务支持 30–240/)).toBeVisible();
  expect(calls).toBe(0);
  await page.getByRole('button', {name:'改为30分钟'}).click();
  await expect(input).toHaveValue('下周三练听力30分钟');
  await expect(send).toBeEnabled();
  await send.click();
  await page.getByRole('button', { name: '带回输入框' }).click();
  await expect(input).toHaveValue('下周三练听力30分钟');
  expect(calls).toBe(1);
  await page.getByRole('button', {name:'历史记录'}).click();
  await expect(page.getByText('下周三练听力30分钟', {exact:true}).last()).toBeVisible();
  await expect(page.getByRole('button', {name:'清空本阶段历史'})).toHaveCount(0);
  await page.getByRole('button', {name:'管理历史'}).click();
  await expect(page.getByRole('button', {name:'清空本阶段历史'})).toBeVisible();
});

test('the default composer edits duration without selecting a workflow', async ({page}) => {
  const button = (name: string) => page.getByRole('button', {name, exact:true});
  await expect(page.getByRole('radio')).toHaveCount(0);
  const input = page.getByRole('textbox', {name:'消息', exact:true});
  await input.fill('明天下午练听力30分钟');
  const sendPosition = await button('发送').boundingBox();
  await button('30 分钟 · 修改').click();
  const duration = page.getByLabel('预计时长（分钟，可选）');
  await expect(duration).toHaveValue('30');
  await duration.fill('60');
  await expect(input).toHaveValue('明天下午练听力60分钟');
  const expandedPosition = await button('发送').boundingBox();
  expect(expandedPosition?.x).toBe(sendPosition?.x);
  expect(expandedPosition?.y).toBe(sendPosition?.y);
  await button('收起选项').click();
  await expect(button('从待办中规划明天')).toHaveCount(0);
});

test('a reflection candidate can be explicitly saved and the decision survives reload', async ({ page }) => {
  await page.route('**/api/v1/reflection/weekly/jobs', route => {
    const { context } = route.request().postDataJSON();
    return route.fulfill({ json: {
      status: 'complete',
      scope: { journeyId: context.journey.id, periodId: context.currentPeriod.id,
        weekStart: context.currentWeek.windowStart, weekEnd: context.currentWeek.windowEnd },
      draft: { summary: '合成周复盘', facts: [], insights: [],
        memoryCandidates: [{ type: 'STRATEGY', confidence: 'LOW', content: '下周尝试记录计划',
          evidence: '参考本周计划任务数',
          references: [{ source: 'STAT', id: 'reviewFacts', field: 'plannedTaskCount', value: context.reviewFacts.plannedTaskCount }] }],
        growth: { version: 1, goalAnalyses: [], nextWeekSuggestions: [], dataGaps: [] } },
    } });
  });
  await page.getByRole('button', {name:'更多选项'}).click();
  await page.getByRole('radio', { name: '本周复盘' }).click();
  await page.getByRole('button', { name: '重新生成本周复盘' }).click();
  await page.getByRole('button', { name: '查看记忆候选' }).click();
  await page.getByRole('button', { name: '保存为长期记忆' }).click();
  await expect(page.getByText('已确认保存', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '查看记忆候选' }).click();
  await expect(page.getByText('已确认保存', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '保存为长期记忆' })).toHaveCount(0);
});
