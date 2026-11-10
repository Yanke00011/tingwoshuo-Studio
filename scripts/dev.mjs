import { spawn } from 'node:child_process';
const children = [
  spawn('pnpm', ['exec', 'wrangler', 'dev', '--config', 'wrangler.dev.toml', '--port', '8787'], { stdio: 'inherit' }),
  spawn('pnpm', ['exec', 'vite', '--host', '127.0.0.1'], { stdio: 'inherit' })
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (!child.killed) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500).unref();
}
for (const child of children) child.on('exit', (code) => stop(code || 0));
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
