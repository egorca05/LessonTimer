const C = window.TimerCore,
  $ = (id) => document.getElementById(id);
let config,
  selected = C.dayKey(new Date()),
  dirty = false,
  activeAudio,
  toastTimer;
function toast(text, error = false) {
  clearTimeout(toastTimer);
  $('toast').textContent = text;
  $('toast').className = error ? 'error' : '';
  $('toast').hidden = false;
  toastTimer = setTimeout(() => ($('toast').hidden = true), 6500);
}
function mark() {
  dirty = true;
  window.timer.dirty(true);
  $('save-status').textContent = 'Есть несохранённые изменения';
  $('save-status').classList.add('dirty');
  updateMeta();
}
function clean() {
  dirty = false;
  window.timer.dirty(false);
  $('save-status').textContent = 'Все изменения сохранены';
  $('save-status').classList.remove('dirty');
}
async function confirmAction(title, text) {
  $('confirm-title').textContent = title;
  $('confirm-text').textContent = text;
  $('confirm').showModal();
  return new Promise((resolve) => {
    $('accept-confirm').onclick = () => {
      $('confirm').close();
      resolve(true);
    };
    $('cancel-confirm').onclick = () => {
      $('confirm').close();
      resolve(false);
    };
    $('confirm').oncancel = () => resolve(false);
  });
}
function dayLabel(key) {
  return C.dayNames[C.days.indexOf(key)];
}
function countLabel(n) {
  return (
    n +
    ' ' +
    (n % 10 === 1 && n % 100 !== 11
      ? 'урок'
      : n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14)
        ? 'урока'
        : 'уроков')
  );
}
function renderDays() {
  $('days').replaceChildren();
  C.days.forEach((day, i) => {
    const button = document.createElement('button');
    button.className =
      'day' + (selected === day ? ' active' : '') + (day === C.dayKey(new Date()) ? ' today' : '');
    button.setAttribute('aria-pressed', selected === day);
    button.title = C.dayNames[i];
    const name = document.createElement('strong');
    name.textContent = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'][i];
    const count = document.createElement('span');
    count.textContent = config.week[day].length ? countLabel(config.week[day].length) : 'Выходной';
    button.append(name, count);
    button.onclick = () => {
      selected = day;
      if (config.mode === 'manual') {
        config.manualDay = day;
        mark();
      }
      render();
    };
    $('days').append(button);
  });
}
function updateMeta() {
  $('day-title').textContent = dayLabel(selected);
  const rows = config.week[selected];
  let total = 0;
  for (const row of rows) {
    try {
      total += Math.max(0, C.minutes(row.end) - C.minutes(row.start));
    } catch {}
  }
  $('day-summary').textContent =
    countLabel(rows.length) + (total ? ' · ' + total + ' минут занятий' : '');
  $('mode-hint').textContent =
    config.mode === 'calendar'
      ? 'День меняется автоматически по часам компьютера.'
      : 'Таймер использует ' +
        dayLabel(config.manualDay).toLowerCase() +
        ', независимо от календаря.';
  const key = config.mode === 'calendar' ? C.dayKey(new Date()) : config.manualDay;
  $('launch-info').textContent =
    (config.mode === 'calendar' ? 'Сегодня: ' : 'Выбран день: ') +
    dayLabel(key).toLowerCase() +
    ' · ' +
    countLabel(config.week[key].length);
  renderDays();
}
function renderLessons() {
  $('lessons').replaceChildren();
  const rows = config.week[selected];
  $('empty').hidden = rows.length !== 0;
  $('add').disabled = rows.length >= 60;
  rows.forEach((row, index) => {
    const wrap = document.createElement('div');
    wrap.className = 'lesson';
    ['start', 'end', 'name'].forEach((field) => {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = row[field];
      input.dataset.field = field;
      if (field !== 'name') {
        input.inputMode = 'numeric';
        input.maxLength = 5;
        input.placeholder = 'ЧЧ:ММ';
        input.className = 'time';
      }
      input.setAttribute(
        'aria-label',
        (field === 'start' ? 'Начало' : field === 'end' ? 'Конец' : 'Название') +
          ' урока ' +
          (index + 1)
      );
      if (field === 'name') {
        input.maxLength = 100;
        input.placeholder = 'Например, Lego';
      }
      if (field === 'name')
        input.oninput = () => {
          row[field] = input.value;
          mark();
        };
      else
        window.TimeInput.attach(input, (value) => {
          row[field] = value;
          mark();
        });
      wrap.append(input);
    });
    const remove = document.createElement('button');
    remove.className = 'icon-button remove';
    remove.textContent = '×';
    remove.title = 'Удалить урок';
    remove.setAttribute('aria-label', 'Удалить урок ' + (index + 1));
    remove.onclick = () => {
      rows.splice(index, 1);
      mark();
      renderLessons();
    };
    wrap.append(remove);
    $('lessons').append(wrap);
  });
}
const soundNames = {
  soft: 'Мягкий',
  classic: 'Школьный',
  digital: 'Электронный',
  custom: 'Свой файл',
  none: 'Без звука',
};
function renderSettings() {
  for (const [id, field] of [
    ['start-sound', 'startSound'],
    ['end-sound', 'endSound'],
  ]) {
    $(id).replaceChildren();
    for (const [key, name] of Object.entries(soundNames)) {
      const option = new Option(name, key);
      option.disabled = key === 'custom' && !config.customSound;
      $(id).append(option);
    }
    $(id).value = config[field];
  }
  $('sound-enabled').checked = config.soundEnabled;
  $('volume').value = config.volume;
  $('volume-label').textContent = config.volume + '%';
  $('opacity').value = config.opacity;
  $('opacity-label').textContent = config.opacity + '%';
  $('compact').checked = config.compact;
  $('mode').value = config.mode;
  $('custom-name').textContent = config.customSound
    ? config.customSound.name
    : 'WAV, MP3 или OGG · до 10 МБ';
}
function render() {
  renderDays();
  renderLessons();
  renderSettings();
  updateMeta();
  $('copy-to').replaceChildren(new Option('Выбрать день', ''));
  C.days
    .filter((day) => day !== selected)
    .forEach((day) => $('copy-to').append(new Option(dayLabel(day), day)));
  $('copy-to').append(new Option('Все будни (Пн–Пт)', 'weekdays'));
}
async function save(start = false) {
  try {
    config.manualDay = selected;
    C.validate(config);
    const result = await window.timer[start ? 'start' : 'save'](config);
    if (!result.ok) throw new Error(result.error);
    config = result.value;
    clean();
    render();
    if (!start) toast('Расписание сохранено');
  } catch (e) {
    toast(e.message, true);
  }
}
async function playSound(key) {
  const result = await window.timer.previewSound(key);
  if (!result.ok) {
    toast(result.error, true);
    return;
  }
  if (!result.value) {
    toast('Для этого звонка выбран режим без звука');
    return;
  }
  if (activeAudio) activeAudio.pause();
  activeAudio = new Audio(result.value.url);
  activeAudio.volume = config.volume / 100;
  try {
    await activeAudio.play();
  } catch {
    toast('Не удалось воспроизвести файл. Попробуйте другой WAV или MP3.', true);
  }
}
async function init() {
  const result = await window.timer.get();
  if (!result.ok) {
    toast(result.error, true);
    return;
  }
  config = result.value;
  if (config.mode === 'manual') selected = config.manualDay;
  render();
  $('add').onclick = () => {
    let start = '13:00',
      end = '13:55';
    const rows = config.week[selected];
    if (rows.length) {
      try {
        let m = C.minutes(rows[rows.length - 1].end) + 10;
        if (m + 55 < 1440) {
          const fmt = (n) =>
            String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
          start = fmt(m);
          end = fmt(m + 55);
        }
      } catch {}
    }
    rows.push({ start, end, name: '' });
    mark();
    renderLessons();
    $('lessons').lastElementChild.querySelector('input[data-field=name]').focus();
  };
  $('save').onclick = () => save();
  $('launch').onclick = () => save(true);
  $('copy').onclick = async () => {
    const target = $('copy-to').value;
    if (!target) {
      toast('Выберите, куда скопировать расписание');
      return;
    }
    const targets =
      target === 'weekdays' ? C.days.slice(0, 5).filter((day) => day !== selected) : [target];
    if (
      targets.some((day) => config.week[day].length) &&
      !(await confirmAction(
        'Заменить расписание?',
        'Текущие занятия в выбранных днях будут заменены расписанием из дня «' +
          dayLabel(selected) +
          '».'
      ))
    )
      return;
    for (const day of targets) config.week[day] = C.copy(config.week[selected]);
    mark();
    renderDays();
    toast('Скопировано. Нажмите «Сохранить», чтобы применить.');
  };
  for (const [id, field] of [
    ['start-sound', 'startSound'],
    ['end-sound', 'endSound'],
    ['mode', 'mode'],
  ])
    $(id).onchange = () => {
      config[field] = $(id).value;
      if (field === 'mode') config.manualDay = selected;
      mark();
    };
  for (const [id, field] of [
    ['sound-enabled', 'soundEnabled'],
    ['compact', 'compact'],
  ])
    $(id).onchange = () => {
      config[field] = $(id).checked;
      mark();
    };
  for (const id of ['volume', 'opacity'])
    $(id).oninput = () => {
      config[id] = Number($(id).value);
      $(id + '-label').textContent = config[id] + '%';
      mark();
    };
  $('test-start').onclick = () => playSound(config.startSound);
  $('test-end').onclick = () => playSound(config.endSound);
  $('custom-sound').onclick = async () => {
    const result = await window.timer.importSound();
    if (!result.ok) {
      toast(result.error, true);
      return;
    }
    if (!result.value) return;
    config.customSound = result.value;
    config.startSound = 'custom';
    renderSettings();
    mark();
    toast('Свой звук выбран для начала урока. Его можно выбрать и для конца.');
  };
  $('export').onclick = async () => {
    try {
      C.validate(config);
      const saved = await window.timer.save(config);
      if (!saved.ok) throw new Error(saved.error);
      config = saved.value;
      clean();
      const r = await window.timer.export();
      if (!r.ok) throw new Error(r.error);
      if (r.value) toast('Расписание и звуки экспортированы');
    } catch (e) {
      toast(e.message, true);
    }
  };
  $('import').onclick = async () => {
    if (
      !(await confirmAction(
        'Открыть другое расписание?',
        'Текущая неделя и настройки будут заменены данными из файла. Сохраните копию через «Экспорт», если она нужна.'
      ))
    )
      return;
    const r = await window.timer.import();
    if (!r.ok) {
      toast(r.error, true);
      return;
    }
    if (r.value) {
      config = r.value;
      if (config.mode === 'manual') selected = config.manualDay;
      clean();
      render();
      toast('Расписание открыто');
    }
  };
  window.timer.onConfig((next) => {
    if (!dirty) {
      config = next;
      render();
    }
  });
}
init();
