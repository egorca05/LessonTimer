const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../src/shared/schedule');
const day = new Date(2026, 10, 13);
const config = C.validate(C.defaults(day));
const at = (h, m, s = 0) => new Date(2026, 10, 13, h, m, s);
test('default schedule only populates current day and seven days exist', () => {
  assert.equal(config.week.fri.length, 5);
  assert.equal(Object.keys(config.week).length, 7);
  for (const key of C.days.filter((k) => k !== 'fri')) assert.equal(config.week[key].length, 0);
});
for (const lesson of config.week.fri)
  test('exact boundaries of ' + lesson.start, () => {
    const start = C.atTime(day, lesson.start),
      end = C.atTime(day, lesson.end);
    assert.notEqual(C.stateAt(config, new Date(start - 1)).kind, 'lesson');
    assert.equal(C.stateAt(config, new Date(start)).kind, 'lesson');
    assert.equal(C.stateAt(config, new Date(start)).title, lesson.name);
    assert.equal(C.countdown(C.stateAt(config, new Date(end - 1000)), end - 1000), '00:01');
    assert.notEqual(C.stateAt(config, new Date(end)).kind, 'lesson');
  });
test('long Construct lesson and ten minute break', () => {
  assert.equal(C.countdown(C.stateAt(config, at(15, 10)), at(15, 10).getTime()), '80:00');
  const state = C.stateAt(config, at(13, 55));
  assert.equal(state.kind, 'break');
  assert.equal(C.countdown(state, at(13, 55).getTime()), '10:00');
});
test('week rollover and next weekly lesson', () => {
  const state = C.stateAt(config, new Date(2026, 10, 14, 13));
  assert.equal(state.kind, 'free');
  assert.match(state.caption, /Пятница/);
  assert.equal(C.stateAt(config, at(18, 40)).kind, 'finished');
  assert.equal(C.stateAt(config, new Date(2026, 10, 20, 13)).kind, 'lesson');
});
test('manual day respects wall clock and does not change at midnight', () => {
  const manual = { ...config, mode: 'manual', manualDay: 'fri' };
  assert.equal(C.stateAt(manual, new Date(2026, 10, 14, 13)).title, 'Lego');
  assert.equal(C.stateAt(manual, new Date(2026, 10, 15, 13)).title, 'Lego');
});
test('sorting, adjacent lessons and overlap validation', () => {
  const conf = C.copy(config);
  conf.week.mon = [
    { start: '14:00', end: '15:00', name: 'B' },
    { start: '13:00', end: '14:00', name: ' A ' },
  ];
  const sorted = C.validate(conf);
  assert.equal(sorted.week.mon[0].name, 'A');
  conf.week.mon[1].end = '14:01';
  assert.throws(() => C.validate(conf), /пересекаются/);
});
test('invalid time, blank names, midnight-spanning, malformed and oversized input are rejected', () => {
  for (const row of [
    { start: '25:00', end: '26:00', name: 'A' },
    { start: '13:00', end: '14:00', name: '' },
    { start: '23:00', end: '01:00', name: 'A' },
    { start: '13:00', end: '13:00', name: 'A' },
  ]) {
    const conf = C.copy(config);
    conf.week.mon = [row];
    assert.throws(() => C.validate(conf));
  }
  assert.throws(() => C.validate({}));
  const conf = C.copy(config);
  conf.week.mon = Array(61).fill({});
  assert.throws(() => C.validate(conf));
});
test('sound fires once at live boundaries, not on launch or after sleep', () => {
  const before = C.stateAt(config, at(13, 54, 59)),
    after = C.stateAt(config, at(13, 55));
  assert.equal(C.cue(before, after, at(13, 55).getTime()), 'end');
  assert.equal(C.cue(after, after, at(13, 55, 1).getTime()), null);
  assert.equal(C.cue(null, after, at(13, 55).getTime()), null);
  assert.equal(C.cue(before, C.stateAt(config, at(14, 10)), at(14, 10).getTime()), null);
  assert.equal(
    C.cue(C.stateAt(config, at(14, 4, 59)), C.stateAt(config, at(14, 5)), at(14, 5).getTime()),
    'start'
  );
  assert.equal(
    C.cue(C.stateAt(config, at(18, 39, 59)), C.stateAt(config, at(18, 40)), at(18, 40).getTime()),
    'end'
  );
});
test('touching lessons play the next lesson start and empty weeks stay free', () => {
  const conf = C.copy(config);
  conf.week.fri = [
    { start: '13:00', end: '14:00', name: 'A' },
    { start: '14:00', end: '15:00', name: 'B' },
  ];
  assert.equal(
    C.cue(C.stateAt(conf, at(13, 59, 59)), C.stateAt(conf, at(14, 0)), at(14, 0).getTime()),
    'start'
  );
  for (const key of C.days) conf.week[key] = [];
  assert.equal(C.stateAt(conf, at(14, 0)).end, null);
});
test('import strips arbitrary paths and clamps settings', () => {
  const conf = C.copy(config);
  conf.customSound = { name: 'A.wav', filePath: '/secret' };
  conf.opacity = 3;
  conf.volume = 200;
  const valid = C.validate(conf);
  assert.deepEqual(valid.customSound, { name: 'A.wav' });
  assert.equal(valid.opacity, 55);
  assert.equal(valid.volume, 100);
});
