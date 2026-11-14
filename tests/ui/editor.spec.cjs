const { test, expect } = require('@playwright/test');
const { openEditor, openWidget } = require('../../scripts/ui-fixture.cjs');

test('numeric time input inserts colon, rejects text, supports paste and editing', async ({
  page,
}) => {
  await openEditor(page);
  const time = page.getByLabel('Начало урока 1', { exact: true });
  await time.fill('');
  await time.pressSequentially('1330');
  await expect(time).toHaveValue('13:30');
  await time.pressSequentially('word');
  await expect(time).toHaveValue('13:30');
  await time.evaluate((el) => el.select());
  await time.pressSequentially('0945');
  await expect(time).toHaveValue('09:45');
  await time.evaluate((el) => {
    el.select();
    const data = new DataTransfer();
    data.setData('text/plain', 'abc17:45текст');
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
    );
  });
  await expect(time).toHaveValue('17:45');
  await time.evaluate((el) => el.setSelectionRange(0, 2));
  await time.pressSequentially('08');
  await expect(time).toHaveValue('08:45');
  await time.evaluate((el) => el.setSelectionRange(5, 5));
  for (let i = 0; i < 4; i++) await time.press('Backspace');
  await expect(time).toHaveValue('');
});
test('add, save and copy a day; overlaps remain unsaved', async ({ page }) => {
  await openEditor(page);
  await page.locator('#days button').nth(0).click();
  await expect(page.locator('#empty')).toBeVisible();
  await page.locator('#add').click();
  await page.getByLabel('Название урока 1', { exact: true }).fill('Робототехника');
  await page.getByLabel('Начало урока 1', { exact: true }).fill('10:00');
  await page.getByLabel('Конец урока 1', { exact: true }).fill('11:00');
  await page.locator('#save').click();
  await expect(page.locator('#toast')).toContainText('сохранено');
  expect(await page.evaluate(() => window.__saved.week.mon[0].name)).toBe('Робототехника');
  await page.locator('#copy-to').selectOption('tue');
  await page.locator('#copy').click();
  await page.locator('#days button').nth(1).click();
  await expect(page.getByLabel('Название урока 1', { exact: true })).toHaveValue('Робототехника');
  await page.locator('#add').click();
  await page.getByLabel('Название урока 2', { exact: true }).fill('Scratch');
  await page.getByLabel('Начало урока 2', { exact: true }).fill('10:30');
  await page.getByLabel('Конец урока 2', { exact: true }).fill('11:30');
  await page.locator('#save').click();
  await expect(page.locator('#toast')).toContainText('пересекаются');
});
test('sound settings and manual day are included when starting timer', async ({ page }) => {
  await openEditor(page);
  await page.locator('#days button').nth(5).click();
  await page.locator('#mode').selectOption('manual');
  await page.locator('#custom-sound').click();
  await expect(page.locator('#start-sound')).toHaveValue('custom');
  await page.locator('#launch').click();
  expect(
    await page.evaluate(() => ({
      started: window.__launched,
      mode: window.__saved.mode,
      day: window.__saved.manualDay,
    }))
  ).toEqual({ started: true, mode: 'manual', day: 'sat' });
});
test('editor has no horizontal overflow at minimum supported width', async ({ page }) => {
  await page.setViewportSize({ width: 860, height: 660 });
  await openEditor(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
for (const compact of [false, true])
  test('widget fits ' + (compact ? 'compact' : 'full') + ' viewport', async ({ page }) => {
    await page.setViewportSize({ width: 328, height: compact ? 136 : 188 });
    await openWidget(page, 'lesson', compact);
    await expect(page.locator('#title')).toHaveText('Construct');
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(
      true
    );
    await expect(page.locator('#detail'))[compact ? 'toBeHidden' : 'toBeVisible']();
  });
