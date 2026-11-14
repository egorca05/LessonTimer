const { test } = require('node:test');
const assert = require('node:assert/strict');
const T = require('../../src/shared/time-input');
test('typing digits inserts the colon after two digits', () => {
  let state = { value: '', caret: 0, end: 0 };
  for (const [digit, expected] of [
    ['1', '1'],
    ['3', '13:'],
    ['3', '13:3'],
    ['0', '13:30'],
  ]) {
    state = T.edit(state.value, state.caret, state.end, 'insertText', digit);
    assert.equal(state.value, expected);
  }
  assert.equal(state.caret, 5);
});
test('letters and punctuation cannot enter the field', () => {
  for (const text of ['word', 'слово', 'e', '-', '.', ':', '😀']) {
    assert.equal(T.edit('13:30', 0, 5, 'insertText', text).value, '13:30');
  }
});
test('pasting strips non-digits and limits length', () => {
  for (const text of ['1330', '13:30', 'abc13:30слово', '133099']) {
    assert.equal(T.edit('', 0, 0, 'insertFromPaste', text).value, '13:30');
  }
});
test('editing overwrites the selected digit without shifting remaining time', () => {
  assert.equal(T.edit('13:30', 0, 0, 'insertText', '2').value, '23:30');
  assert.equal(T.edit('13:30', 3, 3, 'insertText', '4').value, '13:40');
  assert.equal(T.edit('13:30', 0, 2, 'insertText', '09').value, '09:30');
  assert.equal(T.edit('13:30', 0, 5, 'insertText', '1640').value, '16:40');
});
test('typing into a partial selection preserves untyped minute digits', () => {
  let state = T.edit('17:45', 0, 2, 'insertText', '0');
  assert.equal(state.value, '07:45');
  state = T.edit(state.value, state.caret, state.end, 'insertText', '8');
  assert.equal(state.value, '08:45');
});
test('backspace can clear the field including the separator', () => {
  let state = { value: '13:30', caret: 5, end: 5 };
  for (let i = 0; i < 4; i++)
    state = T.edit(state.value, state.caret, state.end, 'deleteContentBackward', null);
  assert.equal(state.value, '');
  assert.equal(state.caret, 0);
  assert.notEqual(T.edit('13:30', 3, 3, 'deleteContentBackward', null).value, '13:30');
});
test('selection deletion and forward deletion work', () => {
  assert.equal(T.edit('13:30', 0, 5, 'deleteContentBackward', null).value, '');
  assert.equal(T.edit('13:30', 0, 0, 'deleteContentForward', null).value, '33:0');
});
test('fallback sanitizes autofill and dropped text', () => {
  assert.equal(T.format('ab13:30c'), '13:30');
  assert.equal(T.format('word'), '');
  assert.equal(T.format('1'), '1');
  assert.equal(T.format('13'), '13:');
});
test('attached events reject words and synchronize the model and caret', () => {
  class Input extends EventTarget {
    constructor() {
      super();
      this.value = '';
      this.selectionStart = 0;
      this.selectionEnd = 0;
    }
    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    }
  }
  const input = new Input();
  let model = '';
  T.attach(input, (value) => (model = value));
  const dispatch = (type, data) => {
    const event = new Event('beforeinput', { cancelable: true });
    Object.defineProperties(event, { inputType: { value: type }, data: { value: data } });
    input.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
  };
  for (const digit of '1330') dispatch('insertText', digit);
  assert.equal(input.value, '13:30');
  assert.equal(model, '13:30');
  assert.equal(input.selectionStart, 5);
  dispatch('insertText', 'слова');
  assert.equal(input.value, '13:30');
  input.setSelectionRange(0, 5);
  const paste = new Event('paste', { cancelable: true });
  Object.defineProperty(paste, 'clipboardData', { value: { getData: () => 'abc09:45word' } });
  input.dispatchEvent(paste);
  assert.equal(input.value, '09:45');
  assert.equal(model, '09:45');
  for (let i = 0; i < 4; i++) dispatch('deleteContentBackward', null);
  assert.equal(input.value, '');
  assert.equal(model, '');
  input.value = 'слова17:45';
  input.selectionStart = input.value.length;
  input.dispatchEvent(new Event('input'));
  assert.equal(model, '17:45');
  assert.equal(input.value, '17:45');
});
