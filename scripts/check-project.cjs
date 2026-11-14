const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
let checked = 0;
function exists(relative) {
  if (!fs.existsSync(path.join(ROOT, relative))) throw new Error('Missing file: ' + relative);
  checked++;
}
for (const file of [
  'LICENSE',
  'README.md',
  'docs/USER_GUIDE.md',
  'docs/DEVELOPMENT.md',
  'docs/PUBLISHING.md',
  'docs/RELEASING.md',
  'electron-builder.yml',
  'build/after-pack.cjs',
  'src/main/index.cjs',
  'src/main/preload.cjs',
  'src/shared/schedule.js',
  'src/shared/time-input.js',
  'assets/icons/icon.ico',
  'assets/icons/icon.icns',
])
  exists(file);
for (const folder of ['src/renderer/editor', 'src/renderer/widget']) {
  const html = fs.readFileSync(path.join(ROOT, folder, 'index.html'), 'utf8');
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g))
    if (!/^(https?:|#|data:)/.test(match[1])) exists(path.join(folder, match[1]));
}
for (const file of [
  'docs/images/editor.png',
  'docs/images/widget-lesson.png',
  'docs/images/widget-break.png',
  'docs/images/widget-compact.png',
])
  exists(file);
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json')));
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json')));
if (pkg.version !== lock.version || pkg.version !== lock.packages[''].version)
  throw new Error('Package and lock versions differ');
const yaml = require('yaml');
const build = yaml.parse(fs.readFileSync(path.join(ROOT, 'electron-builder.yml'), 'utf8'));
if (build.appId !== 'local.lessontimer.desktop')
  throw new Error('Changing appId would affect installer upgrades');
if (build.nsis.deleteAppDataOnUninstall !== false)
  throw new Error('Uninstall must preserve user schedules');
const workflows = ['ci.yml', 'release.yml'];
for (const file of workflows) {
  yaml.parse(fs.readFileSync(path.join(ROOT, '.github/workflows', file), 'utf8'));
  checked++;
}
console.log('PASS: ' + checked + ' project paths, configuration files and release invariants.');
