const FULL = Object.freeze({ width: 328, height: 188 });
const COMPACT = Object.freeze({ width: 270, height: 84 });
module.exports = { FULL, COMPACT, size: (compact) => (compact ? COMPACT : FULL) };
