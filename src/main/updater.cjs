const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { promisify } = require('node:util');
const childProcess = require('node:child_process');
const MacInstall = require('./mac-install.cjs');
const REPO = 'egorca05/LessonTimer';
const RELEASES = 'https://github.com/' + REPO + '/releases';
const API = 'https://api.github.com/repos/' + REPO + '/releases/latest';
const APP_ID = 'local.lessontimer.desktop';
const MAX_BYTES = 512 * 1024 * 1024;
class UpdateError extends Error {}

function version(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(value));
  if (!match) throw new UpdateError('Релиз содержит неподдерживаемый номер версии.');
  const result = match.slice(1).map(Number);
  if (result.some((n) => !Number.isSafeInteger(n)))
    throw new UpdateError('Неверная версия релиза.');
  return result;
}
function newer(candidate, current) {
  const a = version(candidate),
    b = version(current);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}
function assetUrl(url, tag, name) {
  const parsed = new URL(url);
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'github.com' ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== '/' + REPO + '/releases/download/' + tag + '/' + name
  )
    throw new UpdateError('Адрес файла обновления не принадлежит нашему репозиторию.');
  return parsed.href;
}
function selectRelease(data, current, platform, arch) {
  if (data.draft || data.prerelease) return null;
  const numbers = version(data.tag_name),
    target = numbers.join('.');
  if (!newer(target, current)) return null;
  if (
    !['darwin', 'win32'].includes(platform) ||
    !['x64', 'arm64'].includes(arch) ||
    (platform === 'win32' && arch !== 'x64')
  )
    throw new UpdateError('Для этой платформы нет автоматического обновления.');
  const name = `LessonTimer-${target}-${platform === 'darwin' ? 'mac' : 'win'}-${arch}.${platform === 'darwin' ? 'zip' : 'exe'}`;
  const files = Array.isArray(data.assets) ? data.assets : [];
  const asset = files.find((file) => file.name === name && file.state === 'uploaded');
  const sums = files.find((file) => file.name === 'SHA256SUMS.txt' && file.state === 'uploaded');
  if (!asset || !sums)
    throw new UpdateError('Файлы нового релиза ещё не готовы. Повторите проверку позже.');
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_BYTES)
    throw new UpdateError('Размер обновления не поддерживается. Откройте страницу релиза.');
  return {
    version: target,
    tag: data.tag_name,
    name,
    size: asset.size,
    digest: asset.digest,
    url: assetUrl(asset.browser_download_url, data.tag_name, name),
    sumsUrl: assetUrl(sums.browser_download_url, data.tag_name, 'SHA256SUMS.txt'),
  };
}
function checksum(text, name) {
  const matches = text
    .split(/\r?\n/)
    .map((line) => /^([a-f0-9]{64})\s+\*?(.+)$/i.exec(line))
    .filter((m) => m && m[2] === name);
  if (matches.length !== 1)
    throw new UpdateError('Не найдена однозначная контрольная сумма обновления.');
  return matches[0][1].toLowerCase();
}
function appBundle(executable) {
  return path.dirname(path.dirname(path.dirname(executable)));
}

class UpdateManager extends EventEmitter {
  constructor(options) {
    super();
    this.app = options.app;
    this.fetch = options.fetch;
    this.exec = options.exec || promisify(childProcess.execFile);
    this.spawn = options.spawn || childProcess.spawn;
    this.platform = options.platform || process.platform;
    this.arch = options.arch || process.arch;
    this.canQuit = options.canQuit || (() => true);
    this.quit = options.quit || (() => this.app.exit(0));
    this.current = this.app.getVersion();
    this.root = path.join(this.app.getPath('userData'), 'updates');
    this.state = {
      phase: 'idle',
      currentVersion: this.current,
      message: 'Обновления ещё не проверялись.',
      releasesUrl: RELEASES,
    };
    this.available = null;
    this.prepared = null;
    this.controller = null;
    this.installing = false;
  }
  snapshot() {
    return { ...this.state };
  }
  set(update) {
    this.state = { ...this.state, ...update };
    this.emit('state', this.snapshot());
  }
  async support() {
    if (!this.app.isPackaged)
      return { canInstall: false, reason: 'Автоустановка доступна в установленном приложении.' };
    const executable = this.app.getPath('exe');
    if (this.platform === 'win32') {
      const installed = fs.existsSync(
        path.join(path.dirname(executable), 'Uninstall LessonTimer.exe')
      );
      return {
        canInstall: installed,
        reason: installed ? '' : 'Для автообновления используйте версию, установленную через .exe.',
      };
    }
    if (this.platform === 'darwin') {
      const bundle = appBundle(executable);
      if (
        !bundle.endsWith('.app') ||
        bundle.startsWith('/Volumes/') ||
        bundle.includes('/AppTranslocation/')
      )
        return {
          canInstall: false,
          reason: 'Сначала перенесите LessonTimer из образа в папку «Программы».',
        };
      try {
        await fs.promises.access(path.dirname(bundle), fs.constants.W_OK);
        return { canInstall: true, reason: '' };
      } catch {
        return {
          canInstall: false,
          reason:
            'Нет прав для замены приложения. Перенесите его в доступную вам папку «Программы».',
        };
      }
    }
    return { canInstall: false, reason: 'Автоустановка для этой системы не поддерживается.' };
  }
  async check() {
    if (this.checking || this.installing) return this.snapshot();
    this.checking = true;
    this.set({ phase: 'checking', message: 'Проверяем релиз на GitHub…', progress: 0 });
    try {
      const response = await this.fetch(API, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'LessonTimer/' + this.current,
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok)
        throw new UpdateError(
          response.status === 404
            ? 'Публичных обновлений пока нет.'
            : 'GitHub временно недоступен. Повторите позже.'
        );
      const text = await response.text();
      if (text.length > 1024 * 1024)
        throw new UpdateError('Слишком большой ответ сервера обновлений.');
      const release = selectRelease(JSON.parse(text), this.current, this.platform, this.arch);
      if (!release) {
        this.available = null;
        this.set({
          phase: 'current',
          latestVersion: this.current,
          message: 'Установлена последняя версия ' + this.current + '.',
        });
        return this.snapshot();
      }
      if (this.available?.version !== release.version) this.prepared = null;
      this.available = release;
      const support = await this.support();
      this.set({
        phase: 'available',
        latestVersion: release.version,
        ...support,
        message:
          'Доступна версия ' +
          release.version +
          '. ' +
          (support.canInstall ? 'Можно скачать и установить её автоматически.' : support.reason),
      });
    } catch (error) {
      this.set({
        phase: 'error',
        message:
          error instanceof UpdateError
            ? error.message
            : 'Не удалось проверить обновления. Проверьте соединение и повторите позже.',
      });
    } finally {
      this.checking = false;
    }
    return this.snapshot();
  }
  cancel() {
    this.cancelled = true;
    this.controller?.abort();
  }
  async download() {
    const release = this.available;
    if (!release) throw new UpdateError('Сначала проверьте обновления.');
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const folder = fs.mkdtempSync(path.join(this.root, 'update-'));
    const partial = path.join(folder, release.name + '.part');
    let handle;
    this.controller = new AbortController();
    this.cancelled = false;
    const timeout = setTimeout(() => this.controller.abort(), 15 * 60 * 1000);
    timeout.unref?.();
    this.set({
      phase: 'downloading',
      progress: 0,
      message: 'Скачиваем версию ' + release.version + '…',
    });
    try {
      const sumsResponse = await this.fetch(release.sumsUrl, { signal: this.controller.signal });
      if (!sumsResponse.ok) throw new UpdateError('Не удалось получить контрольные суммы.');
      const sums = await sumsResponse.text();
      if (sums.length > 128 * 1024) throw new UpdateError('Неверный файл контрольных сумм.');
      const expected = checksum(sums, release.name);
      if (release.digest && release.digest !== 'sha256:' + expected)
        throw new UpdateError('Контрольные суммы релиза не совпадают.');
      const response = await this.fetch(release.url, { signal: this.controller.signal });
      if (!response.ok || !response.body) throw new UpdateError('Не удалось скачать обновление.');
      handle = await fs.promises.open(partial, 'wx', 0o600);
      const reader = response.body.getReader(),
        hash = crypto.createHash('sha256');
      let bytes = 0,
        last = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > release.size || bytes > MAX_BYTES)
          throw new UpdateError('Файл обновления слишком большой.');
        hash.update(value);
        let offset = 0;
        while (offset < value.length) {
          const result = await handle.write(value, offset, value.length - offset);
          if (!result.bytesWritten) throw new UpdateError('Не удалось записать обновление.');
          offset += result.bytesWritten;
        }
        if (Date.now() - last > 100) {
          last = Date.now();
          this.set({
            progress: Math.min(99, Math.floor((bytes / release.size) * 100)),
            message:
              'Скачано ' +
              Math.floor(bytes / 1024 / 1024) +
              ' из ' +
              Math.ceil(release.size / 1024 / 1024) +
              ' МБ…',
          });
        }
      }
      if (this.controller.signal.aborted) throw new UpdateError('Загрузка прервана.');
      await handle.close();
      handle = null;
      if (bytes !== release.size || hash.digest('hex') !== expected)
        throw new UpdateError('Контрольная сумма не совпала. Обновление не будет установлено.');
      const file = path.join(folder, release.name);
      await fs.promises.rename(partial, file);
      this.set({
        phase: 'verifying',
        progress: 100,
        message: 'Файл проверен. Подготавливаем установку…',
      });
      let stagedApp;
      if (this.platform === 'darwin') {
        const stage = path.join(folder, 'unpacked');
        fs.mkdirSync(stage);
        await this.exec('/usr/bin/ditto', ['-x', '-k', file, stage]);
        stagedApp = path.join(stage, 'LessonTimer.app');
        const plist = path.join(stagedApp, 'Contents', 'Info.plist');
        const id = await this.exec('/usr/libexec/PlistBuddy', [
          '-c',
          'Print :CFBundleIdentifier',
          plist,
        ]);
        const v = await this.exec('/usr/libexec/PlistBuddy', [
          '-c',
          'Print :CFBundleShortVersionString',
          plist,
        ]);
        if (id.stdout.trim() !== APP_ID || v.stdout.trim() !== release.version)
          throw new UpdateError('Идентификатор или версия приложения не совпали.');
        await this.exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', stagedApp]);
      }
      this.prepared = { file, folder, stagedApp, version: release.version };
      this.set({ phase: 'ready', message: 'Обновление проверено и готово к установке.' });
      return this.prepared;
    } catch (error) {
      this.controller?.abort();
      if (handle) await handle.close().catch(() => {});
      fs.rmSync(folder, { recursive: true, force: true });
      throw error;
    } finally {
      clearTimeout(timeout);
      this.controller = null;
    }
  }
  async startProcess(executable, args) {
    const child = this.spawn(executable, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    child.unref();
  }
  async install() {
    if (this.installing) return this.snapshot();
    const support = await this.support();
    if (!support.canInstall) throw new UpdateError(support.reason);
    this.installing = true;
    this.cancelled = false;
    try {
      const payload = this.prepared || (await this.download());
      if (this.cancelled) throw new UpdateError('Загрузка отменена.');
      if (!this.canQuit()) {
        this.set({
          phase: 'ready',
          message: 'Обновление готово. Сохраните изменения и нажмите «Обновить».',
        });
        return this.snapshot();
      }
      if (this.platform === 'darwin') {
        const id = crypto.randomUUID(),
          target = appBundle(this.app.getPath('exe'));
        const backup = path.join(path.dirname(target), '.LessonTimer-backup-' + id + '.app'),
          ack = path.join(this.root, 'ack-' + id + '.json');
        const helper = path.join(payload.folder, 'install.sh');
        fs.writeFileSync(helper, MacInstall.script(), { mode: 0o700 });
        await this.startProcess('/bin/sh', [
          helper,
          String(process.pid),
          target,
          payload.stagedApp,
          backup,
          ack,
          path.join(this.root, 'last-result.json'),
          id,
        ]);
      } else {
        // Standard electron-builder NSIS flags. Its installation registry entry
        // preserves the existing directory and user data.
        await this.startProcess(payload.file, ['--updated', '/S', '--force-run']);
      }
      this.set({
        phase: 'installing',
        message: 'Устанавливаем обновление. Приложение перезапустится…',
      });
      this.quit();
    } catch (error) {
      if (this.cancelled)
        this.set({
          phase: 'available',
          progress: 0,
          message: 'Загрузка отменена. Текущая версия продолжает работать.',
        });
      else
        this.set({
          phase: 'error',
          message:
            error instanceof UpdateError
              ? error.message
              : 'Не удалось установить обновление. Текущая версия сохранена.',
        });
    } finally {
      this.installing = false;
    }
    return this.snapshot();
  }
  acknowledge(args = process.argv) {
    const argument = args.find((value) => /^--lesson-update=[0-9a-f-]{36}$/i.test(value));
    if (!argument) return false;
    const id = argument.split('=')[1];
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      path.join(this.root, 'ack-' + id + '.json'),
      JSON.stringify({ version: this.current }),
      { mode: 0o600 }
    );
    this.set({ phase: 'installed', message: 'Обновлено до версии ' + this.current + '.' });
    return true;
  }
}
module.exports = {
  UpdateManager,
  UpdateError,
  REPO,
  RELEASES,
  API,
  newer,
  version,
  selectRelease,
  checksum,
  assetUrl,
  appBundle,
};
