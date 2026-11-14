const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const C = require('../../src/shared/schedule');
const Layout = require('../../src/shared/window-layout');
const { createRequire } = require('node:module');
const mainRequire = createRequire(path.resolve(__dirname, '../../src/main/index.cjs'));
async function harness() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'lessontimer-test-')),
    handlers = new Map(),
    windows = [];
  let dialogOpen, dialogSave;
  class Window extends EventEmitter {
    constructor(opts) {
      super();
      this.opts = opts;
      this.visible = true;
      this.size = [opts.width, opts.height];
      this.position = [opts.x || 0, opts.y || 0];
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.send = () => {};
      windows.push(this);
    }
    isDestroyed() {
      return false;
    }
    isVisible() {
      return this.visible;
    }
    show() {
      this.visible = true;
    }
    showInactive() {
      this.visible = true;
    }
    focus() {}
    hide() {
      this.visible = false;
    }
    loadFile() {
      setImmediate(() => this.emit('ready-to-show'));
    }
    setAlwaysOnTop(...args) {
      this.top = args;
    }
    setVisibleOnAllWorkspaces() {}
    setOpacity(v) {
      this.opacity = v;
    }
    // Reproduce Electron on Windows: setSize cannot shrink a fixed-size window.
    setSize(width, height) {
      this.size =
        this.opts.resizable === false
          ? [Math.max(width, this.size[0]), Math.max(height, this.size[1])]
          : [width, height];
    }
    setBounds(bounds) {
      this.position = [bounds.x, bounds.y];
      this.size = [bounds.width, bounds.height];
    }
    getPosition() {
      return this.position;
    }
  }
  const app = new EventEmitter();
  app.setName = () => {};
  app.getPath = () => folder;
  app.getVersion = () => require('../../package.json').version;
  app.isPackaged = false;
  app.commandLine = { appendSwitch() {} };
  app.requestSingleInstanceLock = () => true;
  app.whenReady = () => Promise.resolve();
  app.quit = () => {};
  const electron = {
    app,
    BrowserWindow: Window,
    ipcMain: { handle: (key, fn) => handlers.set(key, fn), on() {} },
    dialog: {
      showErrorBox() {},
      showMessageBoxSync: () => 0,
      showOpenDialog: async () => dialogOpen,
      showSaveDialog: async () => dialogSave,
    },
    Menu: { buildFromTemplate: (x) => x, setApplicationMenu() {} },
    Tray: class {
      setToolTip() {}
      setContextMenu() {}
      on() {}
    },
    nativeImage: {
      createFromPath: () => ({
        resize() {
          return this;
        },
      }),
    },
    screen: {
      getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
      getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    },
  };
  const context = {
    require: (spec) =>
      spec === 'electron' ? electron : spec === '../shared/schedule' ? C : mainRequire(spec),
    __dirname: path.resolve(__dirname, '../../src/main'),
    process,
    console,
    Buffer,
    setInterval: () => 0,
    clearInterval() {},
  };
  vm.runInNewContext(
    fs.readFileSync(path.resolve(__dirname, '../../src/main/index.cjs'), 'utf8'),
    context
  );
  await new Promise((r) => setImmediate(r));
  return {
    folder,
    windows,
    call: (name, ...args) => handlers.get(name)({}, ...args),
    pickOpen: (file) => {
      dialogOpen = { canceled: false, filePaths: [file] };
    },
    pickSave: (file) => {
      dialogSave = { canceled: false, filePath: file };
    },
    cleanup: () => fs.rmSync(folder, { recursive: true, force: true }),
  };
}
test('main process saves weekly settings, validates before writing, launches protected topmost widget', async () => {
  const h = await harness();
  try {
    let result = await h.call('config:get');
    assert.equal(result.ok, true);
    const conf = C.copy(result.value);
    conf.week.mon = [{ start: '09:00', end: '10:00', name: 'A' }];
    conf.volume = 42;
    result = await h.call('config:save', conf);
    assert.equal(result.ok, true);
    const persisted = fs.readFileSync(path.join(h.folder, 'schedule-v2.json'), 'utf8');
    assert.equal(JSON.parse(persisted).volume, 42);
    conf.week.mon.push({ start: '09:30', end: '11:00', name: 'B' });
    result = await h.call('config:save', conf);
    assert.equal(result.ok, false);
    assert.equal(fs.readFileSync(path.join(h.folder, 'schedule-v2.json'), 'utf8'), persisted);
    conf.week.mon.pop();
    result = await h.call('timer:start', conf);
    assert.equal(result.ok, true);
    await new Promise((r) => setImmediate(r));
    const w = h.windows[1];
    assert.equal(w.top[0], true);
    assert.equal(w.opts.webPreferences.nodeIntegration, false);
    assert.equal(w.opts.webPreferences.contextIsolation, true);
    assert.equal(w.opts.webPreferences.sandbox, true);
    await h.call('widget:compact');
    assert.equal((await h.call('config:get')).value.compact, true);
  } finally {
    h.cleanup();
  }
});
test('custom sound is copied and exported with schedule, imported and returned for playback', async () => {
  const h = await harness();
  try {
    const original = path.resolve(__dirname, '../../assets/sounds/soft.wav');
    h.pickOpen(original);
    let result = await h.call('sound:import');
    assert.equal(result.ok, true);
    assert.equal(result.value.name, 'soft.wav');
    assert.equal(
      fs.readFileSync(path.join(h.folder, 'custom-sound')).equals(fs.readFileSync(original)),
      true
    );
    const conf = (await h.call('config:get')).value;
    conf.startSound = 'custom';
    assert.equal((await h.call('config:save', conf)).ok, true);
    result = await h.call('sound:preview', 'custom');
    assert.equal(result.ok, true);
    assert.match(result.value.url, /^data:audio\/wav;base64,/);
    const exported = path.join(h.folder, 'export.json');
    h.pickSave(exported);
    assert.equal((await h.call('config:export')).ok, true);
    assert.ok(JSON.parse(fs.readFileSync(exported)).customAudio);
    h.pickOpen(exported);
    assert.equal((await h.call('config:import')).ok, true);
    const invalid = path.join(h.folder, 'invalid.json');
    fs.writeFileSync(invalid, '{}');
    h.pickOpen(invalid);
    assert.equal((await h.call('config:import')).ok, false);
    assert.equal((await h.call('config:get')).value.startSound, 'custom');
  } finally {
    h.cleanup();
  }
});
for (const initiallyCompact of [false, true])
  test(
    'native widget repeatedly shrinks and grows after starting ' +
      (initiallyCompact ? 'compact' : 'full'),
    async () => {
      const h = await harness();
      try {
        const conf = C.copy((await h.call('config:get')).value);
        conf.compact = initiallyCompact;
        assert.equal((await h.call('timer:start', conf)).ok, true);
        await new Promise((resolve) => setImmediate(resolve));
        const w = h.windows[1];
        const initialPosition = w.getPosition().slice();
        assert.deepEqual(w.size, Object.values(Layout.size(initiallyCompact)));
        for (let i = 0; i < 4; i++) {
          const changed = await h.call('widget:compact');
          assert.equal(changed.ok, true);
          assert.deepEqual(w.size, Object.values(Layout.size(changed.value.compact)));
          assert.equal(w.getPosition()[1], initialPosition[1]);
          assert.ok(w.getPosition()[0] + w.size[0] <= 1920);
          assert.equal(w.opts.resizable, false);
        }
        // The same transition must also work from the settings checkbox.
        let current = C.copy((await h.call('config:get')).value);
        current.compact = false;
        assert.equal((await h.call('config:save', current)).ok, true);
        assert.deepEqual(w.size, [328, 188]);
        current.compact = true;
        assert.equal((await h.call('config:save', current)).ok, true);
        assert.deepEqual(w.size, Object.values(Layout.COMPACT));
      } finally {
        h.cleanup();
      }
    }
  );
