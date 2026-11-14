(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TimeInput = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const digits = (text) => String(text || '').replace(/[^0-9]/g, '');
  function format(text) {
    const value = digits(text).slice(0, 4);
    return value.length >= 2 ? value.slice(0, 2) + ':' + value.slice(2) : value;
  }
  function caretFor(count, value) {
    return Math.min(value.length, count + (count >= 2 && value.includes(':') ? 1 : 0));
  }
  function edit(value, start, end, type, data) {
    const original = digits(value).slice(0, 4);
    let from = digits(value.slice(0, start)).length;
    let to = digits(value.slice(0, end)).length;
    let next = original,
      position = from;
    if (type.startsWith('insert')) {
      let incoming = digits(data);
      if (!incoming) return { value, caret: start, end };
      // Overwrite existing digits when typing in the middle, preserving the rest of the time.
      const replaceWholeField = from === 0 && to === original.length && start !== end;
      if (!replaceWholeField) to = Math.min(original.length, from + incoming.length);
      incoming = incoming.slice(0, 4 - (original.length - (to - from)));
      next = original.slice(0, from) + incoming + original.slice(to);
      position = from + incoming.length;
    } else if (type.startsWith('delete')) {
      if (from === to) {
        if (type.includes('Backward')) from = Math.max(0, from - 1);
        else to = Math.min(original.length, to + 1);
      }
      next = original.slice(0, from) + original.slice(to);
      position = from;
    }
    const result = format(next);
    return { value: result, caret: caretFor(position, result), end: caretFor(position, result) };
  }
  function attach(input, changed) {
    const apply = (result) => {
      const previous = input.value;
      input.value = result.value;
      input.setSelectionRange(result.caret, result.end);
      if (previous !== result.value) changed(result.value);
    };
    input.inputMode = 'numeric';
    input.maxLength = 5;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.addEventListener('beforeinput', (event) => {
      if (!event.inputType.startsWith('insert') && !event.inputType.startsWith('delete')) return;
      if (event.inputType.startsWith('insert') && event.data == null) return;
      event.preventDefault();
      apply(
        edit(input.value, input.selectionStart, input.selectionEnd, event.inputType, event.data)
      );
    });
    input.addEventListener('paste', (event) => {
      event.preventDefault();
      apply(
        edit(
          input.value,
          input.selectionStart,
          input.selectionEnd,
          'insertFromPaste',
          event.clipboardData.getData('text')
        )
      );
    });
    // Covers drag-and-drop, autofill and other input paths without beforeinput data.
    input.addEventListener('input', () => {
      const position = digits(input.value.slice(0, input.selectionStart)).length;
      const value = format(input.value);
      input.value = value;
      input.setSelectionRange(caretFor(position, value), caretFor(position, value));
      changed(value);
    });
  }
  return { format, edit, attach };
});
