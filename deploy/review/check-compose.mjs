import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Validate interpolation without a daemon, real credentials, or network changes.
const directory = await mkdtemp(join(tmpdir(), 'bookseerr-review-compose-'));
try {
  const template = await readFile(new URL('.env.example', import.meta.url), 'utf8');
  const values = template
    .split('\n')
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => {
      const split = line.indexOf('=');
      const key = line.slice(0, split);
      let value = line.slice(split + 1);
      if (!value) value = key.endsWith('_ID') ? '1' : 'isolated-validation-placeholder';
      return `${key}=${value}`;
    })
    .join('\n');
  const envFile = join(directory, 'validation.env');
  await writeFile(envFile, values, { mode: 0o600 });
  const binary = process.argv[2] || 'docker';
  const args = process.argv[2] ? [] : ['compose'];
  args.push(
    '--env-file',
    envFile,
    '-f',
    fileURLToPath(new URL('compose.yaml', import.meta.url)),
    'config',
    '--quiet',
  );
  const result = spawnSync(binary, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Review Compose validation failed.');
  console.log('Isolated review Compose configuration is valid.');
} finally {
  await rm(directory, { recursive: true, force: true });
}
