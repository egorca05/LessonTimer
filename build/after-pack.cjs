const path = require('node:path');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const bundle = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app');
  // Finder metadata copied from local files can make codesign reject a fresh bundle.
  // Only the newly generated output is cleaned, before its own signature is created.
  await execFile('/usr/bin/xattr', ['-cr', bundle]);
};
