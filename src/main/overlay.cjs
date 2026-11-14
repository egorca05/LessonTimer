function options(platform = process.platform) {
  return platform === 'darwin'
    ? { type: 'panel', focusable: false, acceptFirstMouse: true, hiddenInMissionControl: true }
    : {};
}
function configure(window, platform = process.platform) {
  if (!window || window.isDestroyed()) return;
  window.setAlwaysOnTop(true, platform === 'darwin' ? 'screen-saver' : 'floating');
  if (platform === 'darwin') {
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.setHiddenInMissionControl?.(true);
  }
}
module.exports = { options, configure };
