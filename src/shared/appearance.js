(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Appearance = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const DEFAULT_ACCENT = '#a1edc6';
  const normalize = (value) =>
    /^#[0-9a-f]{6}$/i.test(value || '') ? value.toLowerCase() : DEFAULT_ACCENT;
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const hex = (values) =>
    '#' + values.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  function luminance(color) {
    const values = rgb(color).map((v) => {
      v /= 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
  }
  function contrast(a, b) {
    const x = luminance(a),
      y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  function mix(a, b, amount) {
    const x = rgb(a),
      y = rgb(b);
    return hex(x.map((v, i) => v * (1 - amount) + y[i] * amount));
  }
  function readable(color, surface, light) {
    for (let i = 0; i <= 100; i++) {
      const candidate = mix(color, light ? '#000000' : '#ffffff', i / 100);
      if (contrast(candidate, surface) >= 4.5) return candidate;
    }
    return light ? '#000000' : '#ffffff';
  }
  function tokens(config = {}, systemDark = true) {
    const theme =
      config.theme === 'system'
        ? systemDark
          ? 'dark'
          : 'light'
        : config.theme === 'light'
          ? 'light'
          : 'dark';
    const light = theme === 'light',
      accent = normalize(config.accentColor),
      panel = light ? '#ffffff' : '#171e29';
    return {
      theme,
      values: {
        '--bg': light ? '#f2f5f8' : '#10151d',
        '--panel': panel,
        '--line': light ? '#d2dbe5' : '#2b3545',
        '--muted': light ? '#586779' : '#a3afbf',
        '--text': light ? '#172535' : '#edf2f8',
        '--input': light ? '#f8fafc' : '#111823',
        '--surface-hover': light ? '#e5ecf3' : '#303c4e',
        '--surface-raised': light ? '#e9eef4' : '#222c3a',
        '--tab': light ? '#e5ebf2' : '#1a2230',
        '--accent-base': accent,
        '--accent': readable(accent, panel, light),
        '--mint': readable(accent, panel, light),
        '--mint-dark': mix(panel, accent, light ? 0.2 : 0.19),
        '--accent-soft': mix(panel, accent, light ? 0.2 : 0.19),
        '--accent-line': mix(panel, accent, 0.6),
        '--button-text':
          contrast(accent, '#000000') >= contrast(accent, '#ffffff') ? '#000000' : '#ffffff',
        '--warning': light ? '#8a5300' : '#efc68b',
        '--danger': light ? '#a5283e' : '#ffb6c4',
        '--error-bg': light ? '#fff0f2' : '#4b2a32',
        '--success-bg': light ? '#e5f4eb' : '#2b4138',
      },
    };
  }
  let last;
  function apply(config, doc = typeof document !== 'undefined' ? document : null) {
    last = config;
    const media =
      typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
    const result = tokens(config, media ? media.matches : true);
    if (doc) {
      doc.documentElement.dataset.theme = result.theme;
      for (const [key, value] of Object.entries(result.values))
        doc.documentElement.style.setProperty(key, value);
    }
    return result;
  }
  if (typeof matchMedia === 'function')
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (last?.theme === 'system') apply(last);
    });
  return { DEFAULT_ACCENT, normalize, contrast, tokens, apply };
});
