import { test, expect } from '@playwright/test';

test('coach opens directly and shows scheduling first with secondary actions collapsed', async ({ page }) => {
  await page.goto('http://localhost:8081/coach');
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.getByRole('button', {name:'从待办中规划明天'})).toHaveCount(0);
  await expect(page.getByText('想安排什么任务？')).toBeVisible();
  await expect(page.getByRole('textbox', {name:'消息'})).toBeEditable();
  await page.getByRole('button', {name:'更多选项'}).click();
  await expect(page.getByRole('radio', {name:'查看本周状态'})).toBeVisible();
});
