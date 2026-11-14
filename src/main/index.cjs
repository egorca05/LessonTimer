const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
  Tray,
  nativeImage,
  screen,
  net,
  shell,
  nativeTheme,
  powerMonitor,
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../shared/schedule');
const Layout = require('../shared/window-layout');
const Overlay = require('./overlay.cjs');
const { UpdateManager, RELEASES } = require('./updater.cjs');
const ROOT = path.resolve(__dirname, '..', '..');
app.setName('LessonTimer');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
let editor,
  widget,
  tray,
  config,
  previous = null,
  ticker,
  quitting = false;
let editorDirty = false;
let updater, overlayWatcher;
function windowBackground() {
  return config?.theme === 'light' ||
    (config?.theme === 'system' && nativeTheme?.shouldUseDarkColors === false)
    ? '#f2f5f8'
    : '#10151d';
}
function maintainOverlay() {
  if (!widget || widget.isDestroyed()) return;
  if (process.platform === 'darwin') {
    if (widget.isVisibleOnAllWorkspaces && !widget.isVisibleOnAllWorkspaces())
      Overlay.configure(widget);
    widget.setAlwaysOnTop(true, 'screen-saver');
    if (!widget.isVisible()) widget.showInactive();
  }
}
function updateState(state) {
  for (const win of [editor, widget])
    if (win && !win.isDestroyed()) win.webContents.send('updates:state', state);
}
async function checkUpdates(manual = false) {
  const state = await updater.check();
  if (state.phase === 'available' && state.canInstall) {
    const answer = await dialog.showMessageBox(editor, {
      type: 'info',
      title: 'Обновление LessonTimer',
      message: 'Доступна новая версия ' + state.latestVersion,
      detail:
        'Скачать и установить обновление? Приложение перезапустится, расписание и настройки сохранятся.',
      buttons: ['Обновить', 'Позже'],
      defaultId: 0,
      cancelId: 1,
    });
    if (answer.response === 0) await updater.install();
  } else if (manual && state.phase === 'available') updateState(state);
  return updater.snapshot();
}
function allowDiscard() {
  if (!editorDirty) return true;
  return (
    dialog.showMessageBoxSync(editor, {
      type: 'question',
      title: 'Несохранённые изменения',
      message: 'Закрыть без сохранения?',
      detail: 'Изменения в расписании и настройках будут потеряны.',
      buttons: ['Остаться', 'Закрыть без сохранения'],
      defaultId: 0,
      cancelId: 0,
    }) === 1
  );
}
const dataPath = () => path.join(app.getPath('userData'), 'schedule-v2.json');
const audioPath = () => path.join(app.getPath('userData'), 'custom-sound');
function persist() {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  const file = dataPath();
  fs.writeFileSync(file + '.tmp', JSON.stringify(config, null, 2), 'utf8');
  fs.renameSync(file + '.tmp', file);
}
function sendConfig() {
  if (nativeTheme) nativeTheme.themeSource = config.theme;
  if (editor && !editor.isDestroyed()) editor.setBackgroundColor?.(windowBackground());
  if (widget && !widget.isDestroyed()) {
    const { width, height } = Layout.size(config.compact);
    const [x, y] = widget.getPosition();
    const position = keepInScreen({ x, y }, width, height);
    widget.setOpacity(config.opacity / 100);
    // setSize clamps a non-resizable Windows window to its previous minimum size.
    // setBounds updates the native bounds and the fixed-size constraints together.
    widget.setBounds({ ...position, width, height }, false);
  }
  for (const win of [editor, widget])
    if (win && !win.isDestroyed()) win.webContents.send('config:changed', config);
  previous = null;
}
function save(input) {
  const valid = Core.validate(input);
  valid.customSound = config.customSound;
  valid.widgetPosition = config.widgetPosition;
  if ((valid.startSound === 'custom' || valid.endSound === 'custom') && !fs.existsSync(audioPath()))
    throw new Error('Сначала выберите свой аудиофайл.');
  config = valid;
  persist();
  sendConfig();
  return config;
}
function wrap(fn) {
  return async (...args) => {
    try {
      return { ok: true, value: await fn(...args) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  };
}
function prefs() {
  return {
    preload: path.join(__dirname, 'preload.cjs'),
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
  };
}
function lockNavigation(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}
function openEditor() {
  if (editor && !editor.isDestroyed()) {
    editor.show();
    editor.focus();
    return;
  }
  editor = new BrowserWindow({
    width: 1040,
    height: 820,
    minWidth: 860,
    minHeight: 660,
    backgroundColor: windowBackground(),
    title: 'Таймер уроков',
    autoHideMenuBar: true,
    icon: path.join(ROOT, 'assets/icons/icon.png'),
    webPreferences: prefs(),
  });
  lockNavigation(editor);
  editor.loadFile(path.join(ROOT, 'src/renderer/editor/index.html'));
  editor.webContents.once('did-finish-load', () => {
    updater?.acknowledge();
    if (updater) updateState(updater.snapshot());
  });
  editor.on('close', (e) => {
    if (!quitting && widget && !widget.isDestroyed() && widget.isVisible()) {
      e.preventDefault();
      editor.hide();
      return;
    }
    if (!quitting && !allowDiscard()) {
      e.preventDefault();
      return;
    }
    editorDirty = false;
  });
  editor.on('closed', () => {
    editor = null;
    if (!widget || widget.isDestroyed() || !widget.isVisible()) app.quit();
  });
}
function keepInScreen(pos, width, height) {
  const area = pos
    ? screen.getDisplayNearestPoint(pos).workArea
    : screen.getPrimaryDisplay().workArea;
  return {
    x: Math.max(
      area.x,
      Math.min(pos ? pos.x : area.x + area.width - width - 24, area.x + area.width - width)
    ),
    y: Math.max(area.y, Math.min(pos ? pos.y : area.y + 24, area.y + area.height - height)),
  };
}
function showWidget() {
  if (widget && !widget.isDestroyed()) {
    widget.showInactive();
    if (editor) editor.hide();
    tick();
    return;
  }
  const { width, height } = Layout.size(config.compact),
    pos = keepInScreen(config.widgetPosition, width, height);
  widget = new BrowserWindow({
    ...pos,
    width,
    height,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: true,
    show: false,
    title: 'Таймер уроков',
    webPreferences: prefs(),
    ...Overlay.options(),
  });
  Overlay.configure(widget);
  widget.setOpacity(config.opacity / 100);
  lockNavigation(widget);
  widget.loadFile(path.join(ROOT, 'src/renderer/widget/index.html'));
  widget.once('ready-to-show', () => {
    if (editor) editor.hide();
    Overlay.configure(widget);
    widget.showInactive();
    previous = null;
    tick();
  });
  widget.on('show', () => Overlay.configure(widget));
  widget.on('blur', () => {
    if (widget && !widget.isDestroyed())
      widget.setAlwaysOnTop(true, process.platform === 'darwin' ? 'screen-saver' : 'floating');
  });
  widget.on('moved', () => {
    const [x, y] = widget.getPosition();
    config.widgetPosition = { x, y };
    try {
      persist();
    } catch {}
  });
  widget.on('closed', () => {
    widget = null;
    previous = null;
    if (!quitting) openEditor();
  });
}
function soundData(key) {
  if (!['soft', 'classic', 'digital', 'custom', 'none'].includes(key))
    throw new Error('Неизвестный звук.');
  if (key === 'none') return null;
  const file = key === 'custom' ? audioPath() : path.join(ROOT, 'assets/sounds', key + '.wav');
  if (!fs.existsSync(file)) throw new Error('Файл звука не найден. Выберите его повторно.');
  const mime = key === 'custom' ? config.customSound?.mime || 'audio/wav' : 'audio/wav';
  return {
    url: 'data:' + mime + ';base64,' + fs.readFileSync(file).toString('base64'),
    volume: config.volume / 100,
  };
}
function tick() {
  if (!widget || widget.isDestroyed() || !widget.isVisible()) {
    previous = null;
    return;
  }
  const state = Core.stateAt(config);
  const cue = Core.cue(previous, state);
  widget.webContents.send('timer:state', state);
  if (cue && config.soundEnabled && config.volume > 0) {
    try {
      const sound = soundData(cue === 'start' ? config.startSound : config.endSound);
      if (sound) widget.webContents.send('sound:play', sound);
    } catch {}
  }
  previous = state;
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => openEditor());
  app.whenReady().then(() => {
    try {
      config = fs.existsSync(dataPath())
        ? Core.validate(JSON.parse(fs.readFileSync(dataPath(), 'utf8')))
        : Core.defaults();
      // The MIME type is not a path and can safely survive loading local settings.
      if (config.customSound) {
        const raw = JSON.parse(fs.readFileSync(dataPath(), 'utf8'));
        config.customSound.mime = ['audio/wav', 'audio/mpeg', 'audio/ogg'].includes(
          raw.customSound?.mime
        )
          ? raw.customSound.mime
          : 'audio/wav';
      }
    } catch (e) {
      dialog.showErrorBox(
        'Не удалось прочитать настройки',
        e.message + '\nСтарый файл сохранён рядом с резервной копией.'
      );
      if (fs.existsSync(dataPath()))
        fs.copyFileSync(dataPath(), dataPath() + '.backup-' + Date.now());
      config = Core.defaults();
    }
    if (nativeTheme) nativeTheme.themeSource = config.theme;
    updater = new UpdateManager({
      app,
      fetch: (url, options) => (net?.fetch ? net.fetch(url, options) : fetch(url, options)),
      canQuit: allowDiscard,
      quit: () => {
        editorDirty = false;
        quitting = true;
        clearInterval(ticker);
        clearInterval(overlayWatcher);
        app.exit(0);
      },
    });
    updater.on('state', updateState);
    ipcMain.handle(
      'updates:info',
      wrap(() => updater.snapshot())
    );
    ipcMain.handle(
      'updates:check',
      wrap(() => checkUpdates(true))
    );
    ipcMain.handle(
      'updates:install',
      wrap(() => updater.install())
    );
    ipcMain.handle(
      'updates:cancel',
      wrap(() => updater.cancel())
    );
    ipcMain.handle(
      'updates:open',
      wrap(() => shell.openExternal(RELEASES))
    );
    ipcMain.handle('config:get', () => ({ ok: true, value: config }));
    ipcMain.on('editor:dirty', (event, value) => {
      if (editor && event.sender === editor.webContents) editorDirty = Boolean(value);
    });
    ipcMain.handle(
      'config:save',
      wrap((_, input) => save(input))
    );
    ipcMain.handle(
      'timer:start',
      wrap((_, input) => {
        save(input);
        showWidget();
        return config;
      })
    );
    ipcMain.handle(
      'window:editor',
      wrap(() => openEditor())
    );
    ipcMain.handle(
      'window:close-widget',
      wrap(() => {
        if (widget) widget.close();
        else openEditor();
      })
    );
    ipcMain.handle(
      'widget:compact',
      wrap(() => {
        config.compact = !config.compact;
        persist();
        sendConfig();
        return config;
      })
    );
    ipcMain.handle(
      'sound:preview',
      wrap((_, key) => soundData(key))
    );
    ipcMain.handle(
      'sound:import',
      wrap(async () => {
        const picked = await dialog.showOpenDialog(editor, {
          title: 'Звук звонка',
          properties: ['openFile'],
          filters: [{ name: 'Аудио (до 10 МБ)', extensions: ['wav', 'mp3', 'ogg'] }],
        });
        if (picked.canceled) return null;
        const source = picked.filePaths[0];
        const ext = path.extname(source).toLowerCase();
        if (!['.wav', '.mp3', '.ogg'].includes(ext) || fs.statSync(source).size > 10 * 1024 * 1024)
          throw new Error('Выберите WAV, MP3 или OGG размером до 10 МБ.');
        fs.mkdirSync(app.getPath('userData'), { recursive: true });
        fs.copyFileSync(source, audioPath());
        config.customSound = {
          name: path.basename(source),
          mime: ext === '.mp3' ? 'audio/mpeg' : ext === '.ogg' ? 'audio/ogg' : 'audio/wav',
        };
        persist();
        return config.customSound;
      })
    );
    ipcMain.handle(
      'config:export',
      wrap(async () => {
        const picked = await dialog.showSaveDialog(editor, {
          title: 'Сохранить расписание',
          defaultPath: 'LessonTimer-schedule.json',
          filters: [{ name: 'Расписание JSON', extensions: ['json'] }],
        });
        if (picked.canceled) return false;
        const out = Core.copy(config);
        delete out.widgetPosition;
        if (config.customSound && fs.existsSync(audioPath()))
          out.customAudio = fs.readFileSync(audioPath()).toString('base64');
        fs.writeFileSync(picked.filePath, JSON.stringify(out, null, 2));
        return true;
      })
    );
    ipcMain.handle(
      'config:import',
      wrap(async () => {
        const picked = await dialog.showOpenDialog(editor, {
          title: 'Открыть расписание',
          properties: ['openFile'],
          filters: [{ name: 'Расписание JSON', extensions: ['json'] }],
        });
        if (picked.canceled) return null;
        if (fs.statSync(picked.filePaths[0]).size > 15 * 1024 * 1024)
          throw new Error('Файл слишком большой (максимум 15 МБ).');
        const raw = JSON.parse(fs.readFileSync(picked.filePaths[0], 'utf8')),
          next = Core.validate(raw);
        if (raw.customAudio && typeof raw.customAudio === 'string' && next.customSound) {
          const bytes = Buffer.from(raw.customAudio, 'base64');
          if (bytes.length > 10 * 1024 * 1024) throw new Error('Звуковой файл слишком большой.');
          fs.mkdirSync(app.getPath('userData'), { recursive: true });
          fs.writeFileSync(audioPath(), bytes);
          next.customSound.mime = ['audio/wav', 'audio/mpeg', 'audio/ogg'].includes(
            raw.customSound?.mime
          )
            ? raw.customSound.mime
            : 'audio/wav';
        } else {
          next.customSound = config.customSound;
          if (!next.customSound) {
            if (next.startSound === 'custom') next.startSound = 'soft';
            if (next.endSound === 'custom') next.endSound = 'classic';
          }
        }
        next.widgetPosition = config.widgetPosition;
        config = next;
        persist();
        sendConfig();
        return config;
      })
    );
    if (process.platform === 'darwin')
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: app.name,
            submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }],
          },
          { role: 'editMenu' },
          { role: 'windowMenu' },
        ])
      );
    else Menu.setApplicationMenu(null);
    tray = new Tray(
      nativeImage
        .createFromPath(path.join(ROOT, 'assets/icons/tray.png'))
        .resize({ width: 18, height: 18 })
    );
    tray.setToolTip('Таймер уроков');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Расписание и настройки', click: openEditor },
        { label: 'Показать таймер', click: showWidget },
        {
          label: 'Проверить обновления',
          click: () => {
            openEditor();
            checkUpdates(true);
          },
        },
        { type: 'separator' },
        { label: 'Выход', click: () => app.quit() },
      ])
    );
    tray.on('double-click', openEditor);
    ticker = setInterval(tick, 250);
    overlayWatcher = setInterval(maintainOverlay, 2000);
    powerMonitor?.on('resume', maintainOverlay);
    screen.on?.('display-metrics-changed', maintainOverlay);
    openEditor();
    if (app.isPackaged && config.checkUpdates) {
      const timer = setTimeout(() => checkUpdates(false), 1600);
      timer.unref?.();
    }
    app.on('activate', () => {
      openEditor();
      maintainOverlay();
    });
  });
  app.on('before-quit', (event) => {
    if (!allowDiscard()) {
      event.preventDefault();
      return;
    }
    editorDirty = false;
    quitting = true;
    clearInterval(ticker);
    clearInterval(overlayWatcher);
    updater?.cancel();
  });
  app.on('window-all-closed', () => {
    if (!quitting) app.quit();
  });
}
