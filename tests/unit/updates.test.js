const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { promisify } = require('node:util');
const exec = promisify(require('node:child_process').execFile);
const U = require('../../src/main/updater.cjs');
const Mac = require('../../src/main/mac-install.cjs');
const A = require('../../src/shared/appearance');
const C = require('../../src/shared/schedule');
const Overlay = require('../../src/main/overlay.cjs');
const payload = Buffer.from('verified test installer');
const digest = crypto.createHash('sha256').update(payload).digest('hex');
function release(platform = 'win', arch = 'x64') {
  const name = `LessonTimer-2.3.0-${platform}-${arch}.${platform === 'mac' ? 'zip' : 'exe'}`;
  const file = (name, size = payload.length) => ({
    name,
    size,
    state: 'uploaded',
    browser_download_url: `https://github.com/${U.REPO}/releases/download/v2.3.0/${name}`,
  });
  return {
    tag_name: 'v2.3.0',
    draft: false,
    prerelease: false,
    assets: [file(name), file('SHA256SUMS.txt')],
  };
}
function harness(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lesson-update-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const exe = path.join(root, 'LessonTimer.exe');
  fs.writeFileSync(path.join(root, 'Uninstall LessonTimer.exe'), 'test');
  let launched = [],
    quit = false;
  const manager = new U.UpdateManager({
    app: {
      getVersion: () => '2.2.0',
      getPath: (key) => (key === 'exe' ? exe : root),
      isPackaged: true,
    },
    platform: 'win32',
    arch: 'x64',
    fetch: async (url) =>
      new Response(
        url === U.API
          ? JSON.stringify(release())
          : url.endsWith('SHA256SUMS.txt')
            ? `${digest}  ${release().assets[0].name}\n`
            : payload
      ),
    spawn: (file, args) => {
      launched.push({ file, args });
      const child = new EventEmitter();
      child.unref = () => {};
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
    quit: () => {
      quit = true;
    },
    ...options,
  });
  return {
    manager,
    root,
    launched,
    get quit() {
      return quit;
    },
  };
}
test('old schedules migrate appearance without changing lessons', () => {
  const original = C.defaults();
  delete original.theme;
  delete original.accentColor;
  delete original.checkUpdates;
  const migrated = C.validate(original);
  assert.equal(migrated.theme, 'dark');
  assert.equal(migrated.checkUpdates, true);
  assert.deepEqual(migrated.week, original.week);
  assert.equal(
    C.validate({ ...original, theme: 'light', accentColor: '#AB12EF', checkUpdates: false })
      .accentColor,
    '#ab12ef'
  );
  assert.equal(
    C.validate({ ...original, accentColor: 'javascript:alert(1)' }).accentColor,
    A.DEFAULT_ACCENT
  );
});
test('themes keep any chosen accent while countdown text stays readable', () => {
  for (const theme of ['light', 'dark'])
    for (const accentColor of ['#000000', '#ffffff', '#ff0000', '#00ff00', '#123abc']) {
      const { values } = A.tokens({ theme, accentColor });
      assert.equal(values['--accent-base'], accentColor);
      assert.ok(A.contrast(values['--accent'], values['--panel']) >= 4.5);
      assert.ok(A.contrast(values['--button-text'], accentColor) >= 4.5);
    }
  assert.equal(A.tokens({ theme: 'system' }, false).theme, 'light');
  assert.equal(A.tokens({ theme: 'system' }, true).theme, 'dark');
});
test('mac overlay uses nonactivating panel; Windows uses regular window', () => {
  assert.equal(Overlay.options('darwin').type, 'panel');
  assert.equal(Overlay.options('darwin').focusable, false);
  assert.deepEqual(Overlay.options('win32'), {});
  const calls = [];
  Overlay.configure(
    {
      isDestroyed: () => false,
      setAlwaysOnTop: (...args) => calls.push(args),
      setVisibleOnAllWorkspaces: (...args) => calls.push(args),
      setHiddenInMissionControl() {},
    },
    'darwin'
  );
  assert.ok(calls.some((args) => args[0] === true && args[1]?.visibleOnFullScreen));
});
test('only newer stable versions and exact platform assets are accepted', () => {
  assert.equal(U.newer('v2.10.0', '2.9.9'), true);
  assert.equal(U.newer('v2.2.0', '2.2.0'), false);
  assert.throws(() => U.version('2.3.0-rc.1'));
  assert.equal(U.selectRelease({ ...release(), prerelease: true }, '2.2.0', 'win32', 'x64'), null);
  assert.equal(U.selectRelease(release(), '2.4.0', 'win32', 'x64'), null);
  assert.match(
    U.selectRelease(release('mac', 'arm64'), '2.2.0', 'darwin', 'arm64').name,
    /arm64.zip$/
  );
  assert.throws(() => U.selectRelease(release('mac', 'x64'), '2.2.0', 'darwin', 'arm64'));
  assert.throws(() =>
    U.selectRelease({ ...release(), assets: release().assets.slice(0, 1) }, '2.2.0', 'win32', 'x64')
  );
});
test('release URL cannot escape repository, change protocol or append query', () => {
  const item = release().assets[0];
  for (const url of [
    item.browser_download_url.replace('github.com', 'evil.example'),
    item.browser_download_url.replace('https:', 'http:'),
    item.browser_download_url + '?file=other',
    item.browser_download_url.replace('github.com', 'github.com:444'),
    item.browser_download_url.replace(U.REPO, 'someone/other'),
  ])
    assert.throws(() => U.assetUrl(url, 'v2.3.0', item.name));
  assert.throws(() => U.checksum(`${digest}  a\n${digest}  a`, 'a'));
});
test('verified Windows installer launches with upgrade flags and quits only after spawn', async (t) => {
  const h = harness(t);
  await h.manager.check();
  await h.manager.install();
  assert.equal(h.manager.snapshot().phase, 'installing');
  assert.equal(h.quit, true);
  assert.equal(h.launched.length, 1);
  assert.deepEqual(h.launched[0].args, ['--updated', '/S', '--force-run']);
  assert.deepEqual(fs.readFileSync(h.launched[0].file), payload);
});
test('corrupt downloads never launch; partial files are removed', async (t) => {
  const h = harness(t);
  await h.manager.check();
  const oldFetch = h.manager.fetch;
  h.manager.fetch = async (url) =>
    url.endsWith('.exe') ? new Response('corrupted') : oldFetch(url);
  await h.manager.install();
  assert.equal(h.quit, false);
  assert.equal(h.launched.length, 0);
  assert.equal(h.manager.snapshot().phase, 'error');
  assert.deepEqual(fs.readdirSync(h.manager.root), []);
});
test('API digest conflicts stop download before execution', async (t) => {
  const h = harness(t);
  await h.manager.check();
  h.manager.available.digest = 'sha256:' + '0'.repeat(64);
  await h.manager.install();
  assert.equal(h.quit, false);
  assert.equal(h.launched.length, 0);
  assert.match(h.manager.snapshot().message, /суммы/);
});
test('unsaved changes retain prepared update for later installation', async (t) => {
  const h = harness(t, { canQuit: () => false });
  await h.manager.check();
  await h.manager.install();
  assert.equal(h.manager.snapshot().phase, 'ready');
  assert.equal(h.quit, false);
  h.manager.canQuit = () => true;
  await h.manager.install();
  assert.equal(h.quit, true);
});
test('offline and portable installations fail without changing app or user data', async (t) => {
  const h = harness(t);
  h.manager.fetch = async () => {
    throw Error('offline');
  };
  await h.manager.check();
  assert.equal(h.manager.snapshot().phase, 'error');
  assert.equal(h.quit, false);
  fs.unlinkSync(path.join(h.root, 'Uninstall LessonTimer.exe'));
  assert.equal((await h.manager.support()).canInstall, false);
  await assert.rejects(h.manager.install());
});
test('cancelling a pending request leaves installed version running', async (t) => {
  const h = harness(t);
  await h.manager.check();
  h.manager.fetch = async (url, { signal }) =>
    new Promise((resolve, reject) =>
      signal.addEventListener('abort', () => reject(Error('aborted')), { once: true })
    );
  const pending = h.manager.install();
  await new Promise((resolve) => setImmediate(resolve));
  h.manager.cancel();
  await pending;
  assert.equal(h.manager.snapshot().phase, 'available');
  assert.equal(h.quit, false);
  assert.equal(h.launched.length, 0);
});
for (const mode of ['success', 'bad-signature', 'no-ack'])
  test('macOS replacement helper: ' + mode, { skip: process.platform === 'win32' }, async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lesson-helper-' spaced-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const target = path.join(root, 'LessonTimer.app'),
      staged = path.join(root, 'staged.app'),
      backup = path.join(root, 'backup.app'),
      ack = path.join(root, 'ack.json'),
      result = path.join(root, 'result.json');
    for (const [folder, value] of [
      [target, 'old'],
      [staged, 'new'],
    ]) {
      fs.mkdirSync(folder);
      fs.writeFileSync(path.join(folder, 'version'), value);
    }
    const launch = path.join(root, 'launch.sh');
    fs.writeFileSync(
      launch,
      '#!/bin/sh\n' + (mode === 'success' ? `touch '${ack.replace(/'/g, "'\\''")}'\n` : 'exit 1\n'),
      { mode: 0o700 }
    );
    const helper = path.join(root, 'install.sh');
    fs.writeFileSync(
      helper,
      Mac.script({
        copyProgram: '/bin/cp',
        copyArgs: ['-R'],
        verifyProgram: mode === 'bad-signature' ? '/usr/bin/false' : '/usr/bin/true',
        verifyArgs: [],
        openProgram: '/usr/bin/true',
        launchProgram: launch,
        waitAttempts: 20,
      })
    );
    let failed = false;
    try {
      await exec('/bin/sh', [helper, '99999999', target, staged, backup, ack, result, 'test-id'], {
        timeout: 10000,
      });
    } catch {
      failed = true;
    }
    assert.equal(failed, mode !== 'success');
    assert.equal(
      fs.readFileSync(path.join(target, 'version'), 'utf8'),
      mode === 'success' ? 'new' : 'old'
    );
    assert.equal(JSON.parse(fs.readFileSync(result)).ok, mode === 'success');
    assert.equal(fs.existsSync(backup), false);
  });

test('Mac download verifies bundle identity and version before permitting replacement', async (t) => {
  const data = release('mac', 'arm64'),
    name = data.assets[0].name;
  const h = harness(t, {
    platform: 'darwin',
    arch: 'arm64',
    fetch: async (url) =>
      new Response(
        url === U.API
          ? JSON.stringify(data)
          : url.endsWith('SHA256SUMS.txt')
            ? `${digest}  ${name}\n`
            : payload
      ),
    exec: async (file, args) => ({
      stdout: args.includes('Print :CFBundleIdentifier') ? 'wrong.bundle.id' : '2.3.0',
    }),
  });
  h.manager.available = U.selectRelease(data, '2.2.0', 'darwin', 'arm64');
  await assert.rejects(h.manager.download(), /Идентификатор/);
  assert.equal(h.manager.prepared, null);
  assert.equal(h.launched.length, 0);
  const commands = [];
  h.manager.exec = async (file, args) => {
    commands.push(file);
    return {
      stdout: args.includes('Print :CFBundleIdentifier') ? 'local.lessontimer.desktop' : '2.3.0',
    };
  };
  await h.manager.download();
  assert.equal(h.manager.snapshot().phase, 'ready');
  assert.ok(commands.includes('/usr/bin/codesign'));
});
test('installer launch failure keeps the running application open', async (t) => {
  const h = harness(t, {
    spawn: () => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('error', Error('no permission')));
      return child;
    },
  });
  await h.manager.check();
  await h.manager.install();
  assert.equal(h.quit, false);
  assert.equal(h.manager.snapshot().phase, 'error');
});
