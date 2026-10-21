import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, Copy, RefreshCw, Search, Undo2, X } from 'lucide-react';
import type { BookResult, LibraryGroup } from '../../shared/types';
import { api, message } from './api';
import { BookGrid } from './Books';

type LibraryData = {
  total: number;
  rawCopies: number;
  hiddenDuplicates: number;
  items: BookResult[];
};
export function LibraryPage({
  revision,
  select,
  sync,
  syncing,
  admin,
}: {
  revision: number;
  select: (b: BookResult) => void;
  sync: () => void;
  syncing: boolean;
  admin: boolean;
}) {
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [kind, setKind] = useState('');
  const [offset, setOffset] = useState(0);
  const [duplicates, setDuplicates] = useState(false);
  const [data, setData] = useState<LibraryData>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [manage, setManage] = useState(false);
  const [selected, setSelected] = useState<BookResult[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [groups, setGroups] = useState<(LibraryGroup & { title: string })[]>([]);
  const [changed, setChanged] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    api<LibraryData>(
      `/library?q=${encodeURIComponent(submitted)}&offset=${offset}&limit=24${kind ? `&kind=${kind}` : ''}${duplicates ? '&duplicates=true' : ''}`,
      'GET',
      undefined,
      controller.signal,
    )
      .then((r) => {
        setData(r);
        setLoading(false);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(message(e));
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [submitted, offset, kind, revision, duplicates, changed]);
  useEffect(() => {
    if (manage)
      void api<{ items: (LibraryGroup & { title: string })[] }>('/library/groups')
        .then((r) => setGroups(r.items))
        .catch((e) => setError(message(e)));
  }, [manage, changed]);
  function search(event: FormEvent) {
    event.preventDefault();
    setSubmitted(query);
    setOffset(0);
  }
  function toggle(book: BookResult) {
    setSelected((current) =>
      current.some((b) => b.book.id === book.book.id)
        ? current.filter((b) => b.book.id !== book.book.id)
        : [...current, book],
    );
  }
  async function undo(id: string) {
    try {
      await api(`/library/groups/${id}`, 'DELETE');
      setChanged((n) => n + 1);
      setSelected([]);
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">CONNECTED SHELVES</p>
          <h1>Your library</h1>
          <p>All your books, together. Duplicate copies share one entry.</p>
        </div>
        <div className="button-row">
          {admin ? (
            <>
              <button
                className="button"
                onClick={() => {
                  setManage(!manage);
                  setSelected([]);
                }}
              >
                <Copy size={16} />
                {manage ? 'Finish grouping' : 'Manage duplicates'}
              </button>
              <button className="button" onClick={sync} disabled={syncing}>
                <RefreshCw size={16} className={syncing ? 'spin' : ''} />
                {syncing ? 'Syncing…' : 'Sync libraries'}
              </button>
            </>
          ) : null}
        </div>
      </div>
      <div className="filter-bar">
        <form className="inline-search" onSubmit={search}>
          <Search size={18} />
          <input
            aria-label="Filter your library"
            placeholder="Search your shelves…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="text-button">Search</button>
        </form>
        <select
          aria-label="Filter by format"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">All formats</option>
          <option value="ebook">Ebooks</option>
          <option value="audiobook">Audiobooks</option>
        </select>
        <label className="checkbox small">
          <input
            type="checkbox"
            checked={duplicates}
            onChange={(e) => {
              setDuplicates(e.target.checked);
              setOffset(0);
            }}
          />
          Duplicates only
        </label>
      </div>
      {data ? (
        <p className="small muted dedupe-note">
          <Copy size={14} />
          {data.total.toLocaleString()} books · {data.rawCopies.toLocaleString()} format records ·{' '}
          {data.hiddenDuplicates.toLocaleString()} duplicate copies grouped
        </p>
      ) : null}
      {manage ? (
        <div className="alert">
          <span>
            Select entries that are the same work to combine different titles or metadata. The
            preferred title and every copy are preserved in Bookseer. Parts and collections should
            stay separate.
          </span>
          <button
            className="button primary small-button"
            disabled={selected.length < 2}
            onClick={() => setConfirm(true)}
          >
            Group {selected.length} selected entries
          </button>
          {selected.length ? (
            <button className="text-button" onClick={() => setSelected([])}>
              Clear selection
            </button>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="alert error">
          {error}
        </p>
      ) : null}
      {loading ? (
        <p className="muted">Loading your shelves…</p>
      ) : data?.items.length ? (
        manage ? (
          <div className="book-grid">
            {data.items.map((book) => (
              <div className="selectable-book" key={book.book.id}>
                <label className="select-copy">
                  <input
                    type="checkbox"
                    aria-label={`Select ${book.book.title} for grouping`}
                    checked={selected.some((b) => b.book.id === book.book.id)}
                    onChange={() => toggle(book)}
                  />
                  Select entry
                </label>
                <BookGrid results={[book]} select={select} />
              </div>
            ))}
          </div>
        ) : (
          <BookGrid results={data.items} select={select} />
        )
      ) : (
        <div className="empty">
          <Copy size={26} />
          <h3>{duplicates ? 'No duplicate copies match this search' : 'No books to show'}</h3>
          <p>Try a different search or check your connected libraries.</p>
        </div>
      )}
      <div className="pagination">
        <button
          className="button"
          disabled={!offset || loading}
          onClick={() => setOffset((n) => Math.max(0, n - 24))}
        >
          <ArrowLeft size={15} />
          Previous
        </button>
        <span className="muted small">
          {data?.total
            ? `${offset + 1}–${Math.min(offset + 24, data.total)} of ${data.total.toLocaleString()}`
            : '0 books'}
        </span>
        <button
          className="button"
          disabled={!data || offset + 24 >= data.total || loading}
          onClick={() => setOffset((n) => n + 24)}
        >
          Next
          <ArrowRight size={15} />
        </button>
      </div>
      {manage && groups.length ? (
        <div className="panel settings-section">
          <h2>Saved groups</h2>
          <p className="muted small">
            Undo removes your grouping rule. Automatic matches by title and author still share one
            entry.
          </p>
          {groups.map((group) => (
            <div className="copy" key={group.id}>
              <span>
                {group.title} · {group.itemIds.length} records
              </span>
              <button className="text-button" onClick={() => void undo(group.id)}>
                <Undo2 size={14} />
                Undo group
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {confirm ? (
        <GroupDialog
          books={selected}
          close={() => setConfirm(false)}
          saved={() => {
            setConfirm(false);
            setSelected([]);
            setChanged((n) => n + 1);
          }}
        />
      ) : null}
    </>
  );
}
function GroupDialog({
  books,
  close,
  saved,
}: {
  books: BookResult[];
  close: () => void;
  saved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [preferred, setPreferred] = useState(books[0].copies?.[0]?.id || '');
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const element = dialog.current!;
    const focused = document.activeElement as HTMLElement;
    element.showModal();
    return () => {
      element.close();
      focused?.focus();
    };
  }, []);
  async function save() {
    setBusy(true);
    setError('');
    try {
      await api('/library/groups', 'POST', {
        canonicalId: preferred,
        itemIds: [...new Set(books.flatMap((book) => book.copies?.map((i) => i.id) || []))],
      });
      saved();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog className="book-dialog group-dialog" ref={dialog} onCancel={close}>
      <button
        className="icon-button dialog-close"
        aria-label="Close grouping review"
        onClick={close}
      >
        <X size={20} />
      </button>
      <p className="eyebrow">REVIEW DUPLICATE COPIES</p>
      <h2>One book, every copy.</h2>
      <p className="muted small">
        Choose the preferred title. Grouping changes how Bookseer displays these entries; your
        library files and metadata remain intact.
      </p>
      {error ? (
        <p className="alert error" role="alert">
          {error}
        </p>
      ) : null}
      {books.map((book) => (
        <label className="candidate checkbox" key={book.book.id}>
          <input
            type="radio"
            name="canonical"
            value={book.copies?.[0]?.id}
            checked={preferred === book.copies?.[0]?.id}
            onChange={(e) => setPreferred(e.target.value)}
          />
          <span>
            <strong>{book.book.title}</strong>
            <small>
              {book.book.author} · {book.copies?.length} format records
            </small>
          </span>
        </label>
      ))}
      <label className="checkbox review-check">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
        />
        I checked that these are the same complete work.
      </label>
      <button
        className="button primary"
        disabled={!acknowledged || busy}
        onClick={() => void save()}
      >
        <Check size={16} />
        {busy ? 'Saving group…' : 'Save group'}
      </button>
    </dialog>
  );
}
