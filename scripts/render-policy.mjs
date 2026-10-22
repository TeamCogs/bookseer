import { readFile, writeFile } from 'node:fs/promises';

// Render the same policy used in repository documentation into the public server build.
const escape = (text) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const source = await readFile(new URL('../docs/privacy.md', import.meta.url), 'utf8');
const blocks = source
  .trim()
  .split(/\n\s*\n/)
  .map((block) => {
    const heading = block.match(/^(#{1,2}) (.*)$/);
    const content = escape(heading ? heading[2] : block.replaceAll('\n', ' ')).replace(
      /\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g,
      '<a href="$2">$1</a>',
    );
    const tag = heading ? 'h' + heading[1].length : 'p';
    return `<${tag}>${content}</${tag}>`;
  })
  .join('\n');
await writeFile(
  new URL('../web/public/privacy.html', import.meta.url),
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bookseerr privacy policy</title><style>body{font:17px/1.7 system-ui;max-width:760px;margin:40px auto;padding:24px;color:#25312d;background:#faf9f5}a{color:#245b47}h1,h2{line-height:1.25}h2{margin-top:2em}</style><main>${blocks}</main></html>\n`,
);
