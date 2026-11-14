(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TimerCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const dayNames = [
    'Понедельник',
    'Вторник',
    'Среда',
    'Четверг',
    'Пятница',
    'Суббота',
    'Воскресенье',
  ];
  const dayKey = (date) => days[(date.getDay() + 6) % 7];
  const example = [
    { start: '13:00', end: '13:55', name: 'Lego' },
    { start: '14:05', end: '15:00', name: 'Scratch' },
    { start: '15:10', end: '16:30', name: 'Construct' },
    { start: '16:40', end: '17:35', name: 'Lego' },
    { start: '17:45', end: '18:40', name: 'Scratch' },
  ];
  const copy = (value) => JSON.parse(JSON.stringify(value));
  function defaults(date = new Date()) {
    return {
      version: 2,
      week: Object.fromEntries(days.map((d) => [d, d === dayKey(date) ? copy(example) : []])),
      mode: 'calendar',
      manualDay: dayKey(date),
      soundEnabled: true,
      startSound: 'soft',
      endSound: 'classic',
      volume: 65,
      compact: false,
      opacity: 100,
      customSound: null,
      theme: 'dark',
      accentColor: '#a1edc6',
      checkUpdates: true,
    };
  }
  function minutes(text) {
    if (typeof text !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(text))
      throw new Error('Укажите время в формате ЧЧ:ММ.');
    return Number(text.slice(0, 2)) * 60 + Number(text.slice(3));
  }
  function validate(input) {
    if (!input || typeof input !== 'object' || !input.week)
      throw new Error('Не найдено недельное расписание.');
    const result = defaults();
    for (const day of days) {
      const rows = input.week[day];
      if (!Array.isArray(rows) || rows.length > 60)
        throw new Error(dayNames[days.indexOf(day)] + ': максимум 60 занятий.');
      result.week[day] = rows
        .map((row, i) => {
          const label = dayNames[days.indexOf(day)] + ', урок ' + (i + 1) + ': ';
          if (!row || typeof row.name !== 'string' || !row.name.trim())
            throw new Error(label + 'введите название.');
          if (row.name.trim().length > 100) throw new Error(label + 'название слишком длинное.');
          let start, end;
          try {
            start = minutes(row.start);
            end = minutes(row.end);
          } catch (e) {
            throw new Error(label + e.message);
          }
          if (end <= start)
            throw new Error(label + 'конец должен быть позже начала в тот же день.');
          return { start: row.start, end: row.end, name: row.name.trim() };
        })
        .sort((a, b) => minutes(a.start) - minutes(b.start));
      for (let i = 1; i < result.week[day].length; i++) {
        const a = result.week[day][i - 1],
          b = result.week[day][i];
        if (minutes(b.start) < minutes(a.end))
          throw new Error(
            dayNames[days.indexOf(day)] + ': «' + a.name + '» и «' + b.name + '» пересекаются.'
          );
      }
    }
    result.mode = input.mode === 'manual' ? 'manual' : 'calendar';
    result.manualDay = days.includes(input.manualDay) ? input.manualDay : dayKey(new Date());
    result.soundEnabled = input.soundEnabled !== false;
    for (const field of ['startSound', 'endSound'])
      result[field] = ['soft', 'classic', 'digital', 'custom', 'none'].includes(input[field])
        ? input[field]
        : result[field];
    result.volume = Math.max(0, Math.min(100, Number(input.volume) || 0));
    result.opacity = Math.max(55, Math.min(100, Number(input.opacity) || 100));
    result.compact = Boolean(input.compact);
    result.theme = ['dark', 'light', 'system'].includes(input.theme) ? input.theme : 'dark';
    result.accentColor = /^#[0-9a-f]{6}$/i.test(input.accentColor || '')
      ? input.accentColor.toLowerCase()
      : '#a1edc6';
    result.checkUpdates = input.checkUpdates !== false;
    // File locations are owned by the main process, never trusted from imported JSON.
    result.customSound =
      input.customSound && typeof input.customSound.name === 'string'
        ? { name: input.customSound.name.slice(0, 120) }
        : null;
    if (
      input.widgetPosition &&
      Number.isFinite(input.widgetPosition.x) &&
      Number.isFinite(input.widgetPosition.y)
    )
      result.widgetPosition = {
        x: Math.round(input.widgetPosition.x),
        y: Math.round(input.widgetPosition.y),
      };
    return result;
  }
  function atTime(date, time) {
    const mins = minutes(time),
      result = new Date(date);
    result.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
    return result.getTime();
  }
  function nextLesson(config, date, includeToday) {
    for (let offset = includeToday ? 0 : 1; offset <= 7; offset++) {
      const candidate = new Date(date);
      candidate.setDate(candidate.getDate() + offset);
      const key = config.mode === 'manual' ? config.manualDay : dayKey(candidate);
      for (const lesson of config.week[key]) {
        const start = atTime(candidate, lesson.start);
        if (start > date.getTime())
          return { ...lesson, startAt: start, day: dayNames[days.indexOf(key)], offset };
      }
    }
    return null;
  }
  function stateAt(config, date = new Date()) {
    const key = config.mode === 'manual' ? config.manualDay : dayKey(date);
    const list = config.week[key],
      time = date.getTime();
    const common = {
      day: dayNames[days.indexOf(key)],
      manual: config.mode === 'manual',
      now: time,
    };
    for (let i = 0; i < list.length; i++) {
      const lesson = list[i],
        start = atTime(date, lesson.start),
        end = atTime(date, lesson.end);
      if (time < start)
        return {
          ...common,
          kind: i ? 'break' : 'waiting',
          title: i ? 'Перемена' : 'Скоро первый урок',
          caption: 'До начала урока',
          start: i ? atTime(date, list[i - 1].end) : null,
          end: start,
          detail: 'Далее: ' + lesson.name + ' · ' + lesson.start,
        };
      if (time < end)
        return {
          ...common,
          kind: 'lesson',
          title: lesson.name,
          caption: 'До конца урока',
          start,
          end,
          detail: lesson.start + ' — ' + lesson.end + ' · Урок ' + (i + 1) + ' из ' + list.length,
        };
    }
    const next = nextLesson(config, date, false);
    return {
      ...common,
      kind: list.length ? 'finished' : 'free',
      title: list.length ? 'Занятия завершены' : 'Сегодня без уроков',
      caption: next
        ? (next.offset === 1 ? 'Завтра' : next.day) + ' в ' + next.start
        : 'Добавьте расписание в меню',
      detail: next ? 'Далее: ' + next.name : 'Хорошего дня!',
      start: null,
      end: null,
    };
  }
  function countdown(state, now = Date.now()) {
    if (state.end == null) return '—';
    const seconds = Math.max(0, Math.ceil((state.end - now) / 1000));
    const minutes = Math.floor(seconds / 60);
    return String(minutes).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
  }
  function cue(previous, current, now = Date.now()) {
    if (
      !previous ||
      previous.end == null ||
      previous.end === current.end ||
      now < previous.end ||
      now - previous.end >= 5000
    )
      return null;
    if (current.kind === 'lesson' && current.start === previous.end) return 'start';
    if (previous.kind === 'lesson') return 'end';
    return null;
  }
  return {
    days,
    dayNames,
    dayKey,
    defaults,
    copy,
    validate,
    minutes,
    atTime,
    stateAt,
    countdown,
    cue,
  };
});
