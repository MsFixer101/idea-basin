import { execFile } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Call Claude CLI with --print mode.
 * Writes prompt + system prompt to temp files, passes them via stdin/args.
 * @param {string} prompt - The user/conversation prompt
 * @param {string} systemPrompt - The system prompt
 * @param {number} [timeout=180000] - Timeout in ms
 * @returns {Promise<string>} Claude's response text
 */
export function callClaude(prompt, systemPrompt, timeout = 180_000) {
  return new Promise((resolve, reject) => {
    const ts = Date.now();
    const systemFile = join(tmpdir(), `ib-claude-system-${ts}.txt`);

    writeFile(systemFile, systemPrompt).then(() => {
      const args = ['--print', '--system-prompt-file', systemFile];
      const env = { ...process.env };
      delete env.CLAUDECODE; // allow nested calls when server runs inside Claude Code

      const child = execFile('claude', args, { timeout, maxBuffer: 10 * 1024 * 1024, env }, (err, stdout) => {
        unlink(systemFile).catch(() => {});

        if (err) {
          if (err.killed) reject(new Error('Claude CLI timed out'));
          else reject(new Error(err.message));
          return;
        }
        resolve(stdout || '');
      });

      // Send prompt via stdin instead of temp file + cat pipe
      child.stdin.write(prompt);
      child.stdin.end();
    }).catch(reject);
  });
}
