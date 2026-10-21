import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import type { CatalogBook, LibraryItem } from '../shared/types.js';
import { hashPassword } from './security.js';

const config = loadConfig({
  BOOKSEER_DEMO: 'true',
  BOOKSEER_ADMIN_PASSWORD: 'demo-password-only',
  BOOKSEER_SESSION_SECRET: 'isolated-demo-data-not-for-production',
  BOOKSEER_PORT: process.env.BOOKSEER_PORT || '5058',
});
const { app, store } = await buildApp(config, { logger: true });
store.db
  .prepare('UPDATE users SET display_name=? WHERE username=?')
  .run('Alex', config.adminUsername);
const reader = store.addUser({
  username: 'reader',
  displayName: 'Jamie',
  passwordHash: await hashPassword('demo-reader-password'),
  role: 'user',
  autoApprove: false,
  weeklyLimit: 5,
});
const titles = [
  ['Pride and Prejudice', 'Jane Austen'],
  ['The Secret Garden', 'Frances Hodgson Burnett'],
  ['Frankenstein', 'Mary Shelley'],
  ['The Great Gatsby', 'F. Scott Fitzgerald'],
  ['A Tale of Two Cities', 'Charles Dickens'],
  ['The Time Machine', 'H. G. Wells'],
  ['Little Women', 'Louisa May Alcott'],
  ['The Adventures of Sherlock Holmes', 'Arthur Conan Doyle'],
  ['A Room of One’s Own', 'Virginia Woolf'],
  ['The Wonderful Wizard of Oz', 'L. Frank Baum'],
  ['Alice’s Adventures in Wonderland', 'Lewis Carroll'],
  ['The Wind in the Willows', 'Kenneth Grahame'],
];
const items: LibraryItem[] = titles.map(([title, author], i) => ({
  id: `bookorbit:demo:${i}:ebook`,
  source: 'bookorbit',
  remoteId: String(i),
  title,
  author,
  mediaKind: 'ebook',
  formats: ['EPUB'],
  available: true,
  identifiers: { isbn: [], work: [] },
}));
items.push({
  ...items[1],
  id: 'bookorbit:demo:1:audiobook',
  mediaKind: 'audiobook',
  formats: ['M4B'],
});
items.push({
  id: 'bookorbit:demo:oath:ebook',
  source: 'bookorbit',
  remoteId: 'oath',
  title: 'Sanderson, Brandon - Stormlight 03 - Oathbringer',
  author: 'Sanderson, Brandon',
  mediaKind: 'ebook',
  formats: ['EPUB'],
  available: true,
  identifiers: { isbn: [], work: ['ol:OL20158882W'] },
});
items.push({ ...items[0], id: 'bookorbit:demo:pride-pdf:ebook', formats: ['PDF'] });
items.push({
  ...items[0],
  id: 'bookorbit:demo:pride-variant:ebook',
  title: 'Pride & Prejudice (1813)',
});
store.replaceInventory('bookorbit', items);
store.setState({
  source: 'chaptarr',
  configured: true,
  status: 'healthy',
  lastSuccess: new Date().toISOString(),
  count: 0,
});
const discoveries: CatalogBook[] = [
  {
    id: 'demo:oathbringer',
    title: 'Oathbringer',
    author: 'Brandon Sanderson',
    year: 2017,
    identifiers: { isbn: [], work: ['ol:OL20158882W'] },
    origin: 'demo',
  },
  ...[
    ['The Odyssey', 'Homer'],
    ['Persuasion', 'Jane Austen'],
    ['The Picture of Dorian Gray', 'Oscar Wilde'],
    ['The War of the Worlds', 'H. G. Wells'],
    ['Dracula', 'Bram Stoker'],
    ['Emma', 'Jane Austen'],
  ].map(([title, author], i) => ({
    id: `demo:${i}`,
    title,
    author,
    year: 1897,
    identifiers: { isbn: [], work: [] },
    origin: 'demo' as const,
  })),
];
discoveries.forEach((book) => store.saveBook(book));
store.createRequest(discoveries[1], 'ebook', reader);
const queued = store.createRequest(discoveries[2], 'audiobook', store.users()[0]);
store.updateRequest(queued.id, 'downloading', 'Chaptarr is downloading the audiobook.');
await app.listen({ host: config.host, port: config.port });
const shutdown = async () => {
  await app.close();
  store.close();
};
process.on('SIGTERM', () => {
  void shutdown();
});
process.on('SIGINT', () => {
  void shutdown();
});
