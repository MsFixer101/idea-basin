// Bootstrap: set up error handlers BEFORE any imports.
// ES module imports are hoisted, so index.js can't set up handlers
// early enough to catch warnings emitted during module loading
// (e.g., @huggingface/transformers / ONNX runtime deprecation warnings).
// When stderr is a pipe (Electron fork), those warnings cause EPIPE.

process.stdout.on('error', () => {});
process.stderr.on('error', () => {});
process.on('uncaughtException', (err) => {
  if (err.code === 'EPIPE' || err.code === 'ECONNRESET' || err.code === 'ERR_STREAM_DESTROYED') return;
  try { process.stderr.write(`Uncaught exception: ${err.stack || err}\n`); } catch {}
  process.exit(1);
});

await import('./index.js');
