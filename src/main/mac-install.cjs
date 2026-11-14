const quote = (value) => "'" + String(value).replace(/'/g, "'\\''") + "'";
function script(options = {}) {
  const copy = [options.copyProgram || '/usr/bin/ditto', ...(options.copyArgs || [])]
    .map(quote)
    .join(' ');
  const verify = [
    options.verifyProgram || '/usr/bin/codesign',
    ...(options.verifyArgs || ['--verify', '--deep', '--strict']),
  ]
    .map(quote)
    .join(' ');
  const open = quote(options.openProgram || '/usr/bin/open');
  const launch = options.launchProgram
    ? quote(options.launchProgram)
    : '"$target/Contents/MacOS/LessonTimer"';
  const attempts = Number.isInteger(options.waitAttempts) ? options.waitAttempts : 200;
  return `#!/bin/sh
set -u
pid="$1"; target="$2"; staged="$3"; backup="$4"; ack="$5"; result="$6"; update_id="$7"
incoming="\${backup}.incoming.app"
moved=0
new_pid=''
status() { printf '%s\\n' "$1" > "\${result}.tmp"; /bin/mv -f "\${result}.tmp" "$result"; }
rollback() {
  if [ -n "$new_pid" ]; then
    /bin/kill -TERM "$new_pid" 2>/dev/null || true
    j=0
    while /bin/kill -0 "$new_pid" 2>/dev/null && [ "$j" -lt 20 ]; do
      j=$((j+1)); /bin/sleep 0.1
    done
  fi
  if [ "$moved" = 1 ]; then
    /bin/rm -rf "$target"
    /bin/mv "$backup" "$target" || true
  fi
  /bin/rm -rf "$incoming"
  status '{"ok":false,"message":"Обновление не запустилось; предыдущая версия восстановлена."}'
  ${open} "$target" >/dev/null 2>&1 || true
  exit 1
}
trap rollback HUP INT TERM
i=0
while /bin/kill -0 "$pid" 2>/dev/null; do
  i=$((i+1)); [ "$i" -lt ${attempts} ] || exit 1
  /bin/sleep 0.2
done
${copy} "$staged" "$incoming" || rollback
${verify} "$incoming" || rollback
/bin/mv "$target" "$backup" || rollback
moved=1
/bin/mv "$incoming" "$target" || rollback
${launch} "--lesson-update=$update_id" >/dev/null 2>&1 &
new_pid=$!
i=0
while [ ! -f "$ack" ]; do
  i=$((i+1)); [ "$i" -lt ${attempts} ] || rollback
  /bin/sleep 0.2
done
/bin/rm -rf "$backup"
/bin/rm -rf "$staged"
/bin/rm -f "$ack"
status '{"ok":true,"message":"Обновление установлено."}'
exit 0
`;
}
module.exports = { script };
