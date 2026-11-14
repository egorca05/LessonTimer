const $ = (id) => document.getElementById(id);
let state, audio;
function render() {
  if (!state) return;
  const idle = ['free', 'finished'].includes(state.kind);
  $('widget').classList.toggle('break', state.kind === 'break' || state.kind === 'waiting');
  $('widget').classList.toggle('idle', idle);
  $('title').textContent = state.title;
  $('caption').textContent = state.caption;
  $('countdown').textContent = idle ? 'Хорошего дня!' : TimerCore.countdown(state);
  $('detail').textContent = state.detail;
  $('day').textContent = state.day;
  $('mode').textContent = state.manual ? 'Выбранный день' : 'По календарю';
  $('progress').value =
    state.start && state.end
      ? Math.max(0, Math.min(1, (Date.now() - state.start) / (state.end - state.start)))
      : 0;
}
function settings(config) {
  document.body.classList.toggle('compact', config.compact);
}
window.timer.onState((next) => {
  state = next;
  render();
});
window.timer.onConfig(settings);
window.timer.get().then((result) => {
  if (result.ok) settings(result.value);
});
window.timer.onSound(async (data) => {
  if (audio) audio.pause();
  audio = new Audio(data.url);
  audio.volume = data.volume;
  try {
    await audio.play();
  } catch {}
});
$('settings').onclick = () => window.timer.editor();
$('close').onclick = () => window.timer.closeWidget();
$('compact').onclick = () => window.timer.compact();
setInterval(render, 200);
