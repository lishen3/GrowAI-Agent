import { expect, test } from '@playwright/test';

// Run against the unpacked Windows app, using Playwright's isolated browser profile.
test.use({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Shanghai' });

test('bulk timetable import stays on Plan, preserves every selected row and refreshes the calendar', async ({ page, context }) => {
  test.setTimeout(60000);
  const origin = 'http://localhost:8081';
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === origin || ['blob:', 'data:'].includes(url.protocol) ? route.continue() : route.abort();
  });
  await page.clock.setFixedTime(new Date('2026-08-31T04:00:00Z'));
  await page.goto(origin + '/period');
  await page.getByText('当前', { exact: true }).first().waitFor();
  await page.getByRole('button', { name: '＋ 新建', exact: true }).click();
  await page.getByLabel('阶段名称').fill('课表回归学期');
  await page.getByLabel('开始日期').fill('2026-08-30');
  await page.getByLabel('结束日期').fill('2027-01-17');
  await page.getByRole('button', { name: '保存阶段' }).click();
  const period = page.getByRole('button', { name: /课表回归学期/ });
  await period.click();
  await expect(period.getByText('当前', { exact: true })).toBeVisible();

  await page.goto(origin + '/plan');
  await expect(page.getByText(/课表回归学期 · 第 2 周/)).toBeVisible();
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  await button('课程表').click();
  await expect(page.getByLabel('教学第 1 周的周一')).toHaveValue('2026-08-31');
  // All 81 distinct rules must be reviewable, including the last row. Only four occur in week 1.
  const rows = Array.from({ length: 81 }, (_, i) =>
    '<tr><td>08:00-08:45</td><td>合成课程' + String(i + 1).padStart(2, '0') + '<br>' +
    (i < 4 ? '第1周' : '第2周') + '</td><td></td><td></td></tr>').join('');
  const html = '<table><tr><th>时间</th><th>周一</th><th>周二</th><th>周三</th></tr>' + rows + '</table>';
  await page.getByPlaceholder('也可以把课程表 HTML 源码粘贴到这里').fill(html);
  await expect(page.getByRole('checkbox')).toHaveCount(81);
  await page.getByRole('checkbox').last().click();
  await page.getByRole('radio', { name: '月视图' }).click();
  await button('导入选中的 80 门课程').click();
  await expect(page.getByText('已导入 80 门课程', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/plan$/);
  await expect(button('编辑')).toHaveCount(80);
  await button('2026-08-31 查看更多日程').click();
  await expect(page.getByRole('button', { name: /^查看日程 合成课程/ })).toHaveCount(4);
  await button('关闭日程列表').click();
  await button('导入选中的 80 门课程').click();
  await expect(page.getByText(/跳过 80 门重复课程/)).toBeVisible();

  await page.getByRole('radio', { name: '周视图' }).click();
  await page.reload();
  const blocks = page.getByRole('button', { name: /^合成课程\d+ 08:00 到 08:45$/ });
  await expect(blocks).toHaveCount(4);
  await button('下一周').click();
  await expect(blocks).toHaveCount(76);
  await expect(button('合成课程81 08:00 到 08:45')).toHaveCount(0);
});
