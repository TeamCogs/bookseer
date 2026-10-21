import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bookResult,
  displayAuthor,
  displayTitle,
  matchAvailability,
  normalizeIsbn,
} from '../server/matching.js';
import { Store } from '../server/store.js';
import { book, fresh, item } from './fixtures.js';

test('recognizes filename-style title and Last, First author without confusing formats', () => {
  assert.equal(displayTitle(item.title, item.author), 'Oathbringer');
  assert.equal(displayAuthor(item.author), 'Brandon Sanderson');
  assert.equal(matchAvailability(book, 'ebook', [item], fresh(), 24).status, 'available');
  assert.equal(matchAvailability(book, 'audiobook', [item], fresh(), 24).status, 'not_found');
});
test('validates ISBN checksums and converts ISBN-10 to ISBN-13', () => {
  assert.equal(normalizeIsbn('0-7653-2637-X'), '9780765326379');
  assert.equal(normalizeIsbn('9780765326370'), undefined);
});
test('parts, volumes, collections and conflicting authors require identity review', () => {
  for (const title of ['Oathbringer Part One', 'Oathbringer Volume 2', 'Oathbringer Omnibus']) {
    assert.equal(
      matchAvailability(
        book,
        'ebook',
        [{ ...item, title, identifiers: book.identifiers }],
        fresh(),
        24,
      ).status,
      'needs_review',
      title,
    );
  }
  assert.notEqual(
    matchAvailability(
      book,
      'ebook',
      [{ ...item, title: book.title, author: 'Someone Else', identifiers: book.identifiers }],
      fresh(),
      24,
    ).status,
    'available',
  );
});
test('absent files, partial evidence, failed sources, and stale scans never prove availability or absence', () => {
  assert.equal(
    matchAvailability(book, 'ebook', [{ ...item, available: false }], fresh(), 24).status,
    'unknown',
  );
  assert.equal(
    matchAvailability(book, 'ebook', [item], [{ ...fresh()[0], status: 'error' }], 24).label,
    'Last seen in library',
  );
  assert.equal(
    matchAvailability(book, 'ebook', [], [{ ...fresh()[0], status: 'error' }], 24).status,
    'unknown',
  );
  assert.equal(
    matchAvailability(
      book,
      'ebook',
      [],
      [{ ...fresh()[0], lastSuccess: '2020-01-01T00:00:00Z' }],
      24,
    ).status,
    'unknown',
  );
  assert.equal(matchAvailability(book, 'ebook', [], [], 24).status, 'unknown');
});
test('manual identity and different-book decisions survive restart but cannot invent missing files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bookseer-match-'));
  const path = join(directory, 'test.sqlite');
  let store = new Store(path);
  try {
    const actor = store.addUser({
      username: 'admin',
      displayName: 'Admin',
      passwordHash: 'test',
      role: 'admin',
      autoApprove: true,
      weeklyLimit: 0,
    });
    const related = { ...item, title: 'Oathbringer Part One', identifiers: book.identifiers };
    store.replaceInventory('bookorbit', [related]);
    store.saveBook(book);
    assert.equal(bookResult(book, store, 24).availability.ebook.status, 'needs_review');
    store.dismissMatches(book.id, 'ebook', [related.id], actor.id);
    store.close();
    store = new Store(path);
    assert.equal(bookResult(book, store, 24).availability.ebook.status, 'not_found');
    store.confirmMatch(book.id, 'ebook', [related.id], actor.id);
    store.close();
    store = new Store(path);
    assert.equal(bookResult(book, store, 24).availability.ebook.confirmed, true);
    assert.equal(bookResult(book, store, 24).availability.ebook.status, 'available');
    store.replaceInventory('bookorbit', []);
    assert.equal(bookResult(book, store, 24).availability.ebook.status, 'unknown');
  } finally {
    store.close();
    rmSync(directory, { recursive: true });
  }
});
