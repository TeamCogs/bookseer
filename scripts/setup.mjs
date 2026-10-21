import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
const template = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
const password = randomBytes(24).toString('base64url');
const key = randomBytes(32).toString('hex');
const output = template
  .replace('BOOKSEERR_ADMIN_PASSWORD=\n', `BOOKSEERR_ADMIN_PASSWORD=${password}\n`)
  .replace('BOOKSEERR_SESSION_SECRET=\n', `BOOKSEERR_SESSION_SECRET=${key}\n`);
try {
  await writeFile(new URL('../.env', import.meta.url), output, { mode: 0o600, flag: 'wx' });
  console.log(
    'Created a private .env with independent random credentials. Read BOOKSEERR_ADMIN_PASSWORD in that file to sign in.',
  );
} catch (error) {
  if (error.code === 'EEXIST') {
    console.error('.env already exists. Nothing changed.');
    process.exitCode = 1;
  } else throw error;
}
