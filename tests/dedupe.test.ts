import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupInventory, bookResult, itemAsBook } from '../server/matching.js';
import { Store } from '../server/store.js';
import { item, book } from './fixtures.js';

test('dedupe combines filenames, ebook/audio, editions and sources while retaining every copy', () => {
  const copies = [
    item,
    { ...item, id: 'b', title: book.title, author: book.author, formats: ['PDF'] },
    {
      ...item,
      id: 'c',
      source: 'chaptarr' as const,
      mediaKind: 'audiobook' as const,
      formats: ['M4B'],
    },
  ];
  const groups = groupInventory(copies);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].copies.length, 3);
  assert.equal(groups[0].duplicates, 1);
});
test('a fulfilled request can reacquire a missing copy while retaining a fair rolling quota', () => {
  const store = new Store(':memory:');
  try {
    store.saveBook(book);
    const actor = store.addUser({
      username: 'reader',
      displayName: 'Reader',
      passwordHash: 'test',
      role: 'user',
      autoApprove: false,
      weeklyLimit: 2,
    });
    const first = store.createRequest(book, 'ebook', actor);
    store.updateRequest(first.id, 'available', 'Available.');
    const second = store.createRequest(book, 'ebook', actor);
    assert.equal(second.id, first.id);
    assert.equal(second.created, true);
    assert.equal(store.request(first.id)?.status, 'pending_approval');
    store.updateRequest(first.id, 'available', 'Available again.');
    assert.throws(() => store.createRequest(book, 'ebook', actor), /weekly request limit/);
    assert.equal(store.requestsFor(actor).length, 1);
  } finally {
    store.close();
  }
});
test('dedupe preserves parts, volumes, collections, distinct authors and incomplete identity', () => {
  const copies = [
    item,
    { ...item, id: 'part', title: 'Oathbringer Part One' },
    { ...item, id: 'box', title: 'Oathbringer Collection' },
    { ...item, id: 'author', author: 'Different Author' },
    { ...item, id: 'unknown1', title: 'Untitled', author: '' },
    { ...item, id: 'unknown2', title: 'Untitled', author: '' },
    { ...item, id: 'placeholder1', title: 'Untitled', author: 'Unknown Author' },
    { ...item, id: 'placeholder2', title: 'Untitled', author: 'Unknown Author' },
  ];
  assert.equal(groupInventory(copies).length, 8);
});

test('shared work identities group canonical subtitles and expanded author names without grouping parts or conflicting authors', () => {
  const primary = {
    ...item,
    title: 'Frankenstein',
    author: 'Mary Shelley',
    identifiers: { isbn: [], work: ['hc:23293'] },
  };
  const canonical = {
    ...primary,
    id: 'canonical',
    title: 'Frankenstein or The Modern Prometheus',
    author: 'Mary Wollstonecraft Shelley',
  };
  const part = { ...canonical, id: 'part', title: 'Frankenstein Part One' };
  const conflict = { ...canonical, id: 'conflict', author: 'A Different Author' };
  const groups = groupInventory([primary, canonical, part, conflict]);
  assert.equal(groups.length, 3);
  assert.equal(groups.find((group) => group.copies.includes(primary))?.copies.length, 2);
});

test('local and online identities share one format request, follower list, and reacquisition record', () => {
  const store = new Store(':memory:');
  try {
    const actor = store.addUser({
      username: 'reader',
      displayName: 'Reader',
      passwordHash: 'test',
      role: 'user',
      autoApprove: false,
      weeklyLimit: 3,
    });
    const local = itemAsBook(item);
    store.saveBook(book);
    store.saveBook(local);
    const first = store.createRequest(book, 'audiobook', actor);
    const second = store.createRequest(local, 'audiobook', actor);
    assert.equal(second.id, first.id);
    assert.equal(second.created, false);
    assert.equal(store.requestsFor(actor).length, 1);
    assert.equal(store.relatedRequests(local)[0].id, first.id);
    store.updateRequest(first.id, 'available', 'Available.');
    const again = store.createRequest(local, 'audiobook', actor);
    assert.equal(again.id, first.id);
    assert.equal(again.created, true);
    assert.equal(store.requestsFor(actor).length, 1);
    const part = { ...book, id: 'ol:part', title: 'Oathbringer Part One' };
    store.saveBook(part);
    assert.notEqual(store.createRequest(part, 'audiobook', actor).id, first.id);
  } finally {
    store.close();
  }
});
test('saved library groups use the preferred title, improve format availability, and can be undone without touching inventory', () => {
  const store = new Store(':memory:');
  try {
    const actor = store.addUser({
      username: 'admin',
      displayName: 'Admin',
      passwordHash: 'test',
      role: 'admin',
      autoApprove: true,
      weeklyLimit: 0,
    });
    const alternate = {
      ...item,
      id: 'alternate',
      title: 'An alternative edition title',
      mediaKind: 'audiobook' as const,
      formats: ['M4B'],
    };
    store.replaceInventory('bookorbit', [item, alternate]);
    assert.equal(groupInventory(store.inventory()).length, 2);
    const id = store.groupLibrary([item.id, alternate.id], item.id, actor.id);
    const groups = groupInventory(store.inventory(), store.libraryGroups());
    assert.equal(groups.length, 1);
    assert.equal(groups[0].primary.id, item.id);
    assert.equal(
      bookResult(itemAsBook(item), store, 24).availability.audiobook.status,
      'available',
    );
    assert.equal(bookResult(book, store, 24).availability.audiobook.status, 'available');
    store.db.prepare('DELETE FROM library_groups WHERE id=?').run(id);
    assert.equal(groupInventory(store.inventory(), store.libraryGroups()).length, 2);
    assert.equal(store.inventory().length, 2);
  } finally {
    store.close();
  }
});
