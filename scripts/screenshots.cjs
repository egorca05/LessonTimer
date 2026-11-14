const fs = require('node:fs');
const path = require('node:path');
const { ROOT, openEditor, openWidget } = require('./ui-fixture.cjs');

async function capture(browser) {
  const out = path.join(ROOT, 'docs/images');
  fs.mkdirSync(out, { recursive: true });
  const context = await browser.newContext({
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    deviceScaleFactor: 2,
  });
  try {
    const editor = await context.newPage();
    await editor.setViewportSize({ width: 1040, height: 820 });
    await openEditor(editor);
    await editor.screenshot({ path: path.join(out, 'editor.png') });
    await editor.locator('#theme').selectOption('light');
    await editor.locator('#accent-hex').fill('#4979e8');
    await editor.locator('#accent-hex').press('Tab');
    await editor.clock.runFor(300);
    await editor.locator('#save').click();
    await editor.locator('#toast').evaluate((el) => (el.hidden = true));
    await editor.screenshot({ path: path.join(out, 'editor-light.png') });
    await editor.close();
    for (const [kind, compact, file] of [
      ['lesson', false, 'widget-lesson.png'],
      ['break', false, 'widget-break.png'],
      ['lesson', true, 'widget-compact.png'],
    ]) {
      const page = await context.newPage();
      await page.setViewportSize(
        compact ? { width: 270, height: 84 } : { width: 328, height: 188 }
      );
      await openWidget(page, kind, compact);
      await page.screenshot({ path: path.join(out, file), omitBackground: true });
      await page.close();
    }
    console.log('Saved five screenshots of the real renderer with demonstration data.');
  } finally {
    await context.close();
  }
}
if (require.main === module) {
  (async () => {
    const { chromium } = require('playwright');
    const browser = await chromium.launch({
      headless: true,
      ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    });
    try {
      await capture(browser);
    } finally {
      await browser.close();
    }
  })().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
module.exports = { capture };
