const path = require('node:path');
const { pathToFileURL } = require('node:url');
const Core = require('../src/shared/schedule');
const ROOT = path.resolve(__dirname, '..');
const DEMO_NOW = '2026-11-13T15:50:55+03:00';
const copy = (value) => JSON.parse(JSON.stringify(value));

function editorConfig() {
  return Core.defaults(new Date(2026, 10, 13, 13));
}
async function openEditor(page, config = editorConfig()) {
  await page.clock.install({ time: new Date(DEMO_NOW) });
  await page.addInitScript((initial) => {
    const clone = (value) => JSON.parse(JSON.stringify(value));
    let config = clone(initial);
    window.__saved = null;
    window.__launched = false;
    const save = (data) => {
      try {
        config = window.TimerCore.validate(data);
        window.__saved = clone(config);
        return { ok: true, value: clone(config) };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    };
    // Renderer-only test bridge. The real application always uses preload IPC.
    window.timer = {
      get: async () => ({ ok: true, value: clone(config) }),
      save: async (data) => save(data),
      start: async (data) => {
        const result = save(data);
        if (result.ok) window.__launched = true;
        return result;
      },
      dirty() {},
      onConfig() {},
      importSound: async () => ({ ok: true, value: { name: 'Мой звонок.wav' } }),
      previewSound: async () => ({ ok: true, value: null }),
      export: async () => ({ ok: true, value: true }),
      import: async () => ({ ok: true, value: null }),
    };
  }, copy(config));
  await page.goto(pathToFileURL(path.join(ROOT, 'src/renderer/editor/index.html')).href);
  await page.locator('#day-title').waitFor();
  await page.locator('.day.active').waitFor();
}
async function openWidget(page, kind = 'lesson', compact = false) {
  const now = new Date(DEMO_NOW).getTime();
  const lesson = {
    kind: 'lesson',
    title: 'Construct',
    caption: 'До конца урока',
    detail: '15:10 — 16:30 · Урок 3 из 5',
    day: 'Пятница',
    manual: false,
    start: now - 40 * 60000,
    end: now + 2345000,
  };
  const pause = {
    kind: 'break',
    title: 'Перемена',
    caption: 'До начала урока',
    detail: 'Далее: Lego · 16:40',
    day: 'Пятница',
    manual: false,
    start: now - 185000,
    end: now + 415000,
  };
  await page.clock.install({ time: new Date(DEMO_NOW) });
  await page.addInitScript(
    ({ state, compact }) => {
      window.timer = {
        get: async () => ({ ok: true, value: { compact } }),
        onState: (fn) => queueMicrotask(() => fn(state)),
        onConfig() {},
        onSound() {},
        editor() {},
        closeWidget() {},
        compact() {},
      };
    },
    { state: kind === 'break' ? pause : lesson, compact }
  );
  await page.goto(pathToFileURL(path.join(ROOT, 'src/renderer/widget/index.html')).href);
  await page
    .locator('#title')
    .filter({ hasText: kind === 'break' ? 'Перемена' : 'Construct' })
    .waitFor();
}
module.exports = { ROOT, openEditor, openWidget, editorConfig };
