'use strict';
// Portable supplied-paragraph helper. It never discovers chats or reads transcripts.
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {ROOT, parseCli} = require('./runtime');

function suppliedSpeechArgs(argv, threadId) {
  const args = parseCli(argv, {command: 'speak'}, ['command', 'text', 'textFile', 'stdin', 'wait', 'id', 'enqueue', 'sessionId']);
  const result = [...argv];
  if (args.command !== 'speak') return result;
  // Normal conversation admits to the queue and returns without waiting for audio.
  if (args.enqueue === undefined) result.push('--enqueue', 'true');
  if (args.enqueue === false || args.sessionId !== undefined || threadId === undefined || threadId === '') return result;
  if (typeof threadId !== 'string' || threadId.length > 256 || /[\x00-\x20\x7f]/.test(threadId)) throw Error('invalid-supplied-chat-identity');
  result.push('--session-id', 'codex-' + crypto.createHash('sha256').update(threadId).digest('hex').slice(0, 24));
  return result;
}

function main() {
  const args = suppliedSpeechArgs(process.argv.slice(2), process.env.CODEX_THREAD_ID);
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'browser-speak.js'), ...args], {
    env: {...process.env}, windowsHide: true, stdio: 'inherit', timeout: 150000, shell: false
  });
  if (result.error) {
    console.error(result.error.code === 'ETIMEDOUT' ? 'default-speech-command-timeout' : 'default-speech-command-unavailable');
    process.exitCode = 1;
    return;
  }
  process.exitCode = result.status === null ? 1 : result.status;
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(/^[a-z-]+$/.test(error.message || '') ? error.message : 'invalid-default-speech-options');
    process.exitCode = 1;
  }
}
module.exports = {suppliedSpeechArgs};
