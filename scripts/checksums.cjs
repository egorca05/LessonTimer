const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const folder = path.resolve(process.argv[2] || 'dist');
const files = fs
  .readdirSync(folder)
  .filter((name) => /\.(exe|dmg|zip)$/.test(name))
  .sort();
if (!files.length) throw new Error('No installer/archive files found in ' + folder);
const rows = files.map(
  (name) =>
    crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(folder, name)))
      .digest('hex') +
    '  ' +
    name
);
fs.writeFileSync(path.join(folder, 'SHA256SUMS.txt'), rows.join('\n') + '\n');
console.log('Created checksums for ' + files.length + ' files.');
