import { useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Headphones,
  Check,
  X,
  ArrowUpRight,
  Plus,
  ShieldCheck,
  Search,
} from 'lucide-react';
import type { Availability, BookResult, MediaKind, User } from '../../shared/types';
import { api, message } from './api';

export function Cover({
  title,
  author,
  url,
  large = false,
}: {
  title: string;
  author: string;
  url?: string;
  large?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const shade = [...title].reduce((a, c) => a + c.charCodeAt(0), 0) % 5;
  return (
    <div className={`cover shade-${shade} ${large ? 'cover-large' : ''}`}>
      <div className="cover-art">
        <BookOpen size={26} />
        <span>{title}</span>
        <small>{author}</small>
        <i />
      </div>
      {url && !failed ? (
        <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : null}
    </div>
  );
}
export function AvailabilityBadge({ value, kind }: { value: Availability; kind: MediaKind }) {
  const Icon = kind === 'ebook' ? BookOpen : Headphones;
  return (
    <span
      className={`availability ${value.status}`}
      title={`${kind === 'ebook' ? 'Ebook' : 'Audiobook'}: ${value.reason}`}
    >
      <Icon size={12} />
      {value.status === 'available'
        ? kind === 'ebook'
          ? 'Ebook'
          : 'Audio'
        : value.status === 'not_found'
          ? kind === 'ebook'
            ? 'No ebook'
            : 'No audio'
          : value.status === 'needs_review'
            ? 'Check copy'
            : 'Unverified'}
      {value.status === 'available' ? <Check size={12} /> : null}
    </span>
  );
}
export function BookGrid({
  results,
  select,
}: {
  results: BookResult[];
  select: (book: BookResult) => void;
}) {
  return (
    <div className="book-grid">
      {results.map((result, index) => (
        <button
          className="book-card"
          key={`${result.book.id}:${index}`}
          onClick={() => select(result)}
          aria-label={`View ${result.book.title} by ${result.book.author}`}
        >
          <div className="book-cover">
            <Cover
              title={result.book.title}
              author={result.book.author}
              url={result.book.coverUrl}
            />
            <span className="card-open">
              <Plus size={18} />
            </span>
          </div>
          <div className="book-info">
            <div className="badges">
              <AvailabilityBadge value={result.availability.ebook} kind="ebook" />
              <AvailabilityBadge value={result.availability.audiobook} kind="audiobook" />
              {Object.values(result.requests || {}).some(
                (r) => !['available', 'cancelled', 'rejected'].includes(r.status),
              ) ? (
                <span className="availability needs_review">Requested</span>
              ) : null}
            </div>
            <h3>{result.book.title}</h3>
            <p>{result.book.author || 'Unknown author'}</p>
          </div>
        </button>
      ))}
    </div>
  );
}

export function BookDialog({
  initial,
  user,
  onClose,
  onUpdate,
  onRequested,
}: {
  initial: BookResult;
  user: User;
  onClose: () => void;
  onUpdate: () => void;
  onRequested: (text: string) => void;
}) {
  const [result, setResult] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current!;
    const focused = document.activeElement as HTMLElement;
    node.showModal();
    return () => {
      node.close();
      focused?.focus();
    };
  }, []);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await action();
      onUpdate();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const request = (kind: MediaKind) =>
    run(async () => {
      const data = await api<{ joined: boolean; request: { message: string } }>(
        '/requests',
        'POST',
        { catalogId: result.book.id, mediaKind: kind },
      );
      onRequested(
        data.joined
          ? `You’re following the existing request. ${data.request.message}`
          : data.request.message,
      );
      onClose();
    });
  const match = (kind: MediaKind, itemIds: string[], dismiss = false) =>
    run(async () => {
      setResult(
        await api<BookResult>(dismiss ? '/matches/dismiss' : '/matches', 'POST', {
          catalogId: result.book.id,
          mediaKind: kind,
          itemIds,
        }),
      );
    });
  return (
    <dialog
      ref={dialog}
      aria-labelledby="book-detail-title"
      className="book-dialog"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
    >
      <button
        className="icon-button dialog-close"
        aria-label="Close book details"
        onClick={onClose}
      >
        <X size={20} />
      </button>
      <div className="detail-heading">
        <Cover
          title={result.book.title}
          author={result.book.author}
          url={result.book.coverUrl}
          large
        />
        <div>
          <p className="eyebrow">YOUR NEXT CHAPTER</p>
          <h2 id="book-detail-title">{result.book.title}</h2>
          <p className="detail-author">{result.book.author}</p>
          <p className="muted">
            {result.book.year || 'Publication year unavailable'} ·{' '}
            {result.book.origin === 'openlibrary'
              ? 'Open Library'
              : result.book.origin === 'demo'
                ? 'Sample catalogue'
                : 'Connected library'}
          </p>
        </div>
      </div>
      {error ? (
        <p className="alert error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="format-options">
        {(['ebook', 'audiobook'] as MediaKind[]).map((kind) => {
          const availability = result.availability[kind];
          const missingAgain =
            result.requests?.[kind]?.status === 'available' && availability.status === 'not_found';
          const Icon = kind === 'ebook' ? BookOpen : Headphones;
          return (
            <section className="format-panel" key={kind}>
              <div className="format-title">
                <Icon size={21} />
                <h3>{kind === 'ebook' ? 'Ebook' : 'Audiobook'}</h3>
                <span className={`status-dot ${availability.status}`} />
              </div>
              <strong className={availability.status === 'available' ? 'green-text' : ''}>
                {availability.label}
              </strong>
              <p className="muted small">{availability.reason}</p>
              {availability.confirmed ? (
                <p className="small green-text">
                  <ShieldCheck size={14} /> Identity confirmed by an administrator
                </p>
              ) : null}
              {availability.items.map((item) => (
                <div className="copy" key={item.id}>
                  <span>
                    {item.source === 'bookorbit' ? 'BookOrbit' : 'Chaptarr'} ·{' '}
                    {item.formats.join(', ') || kind}
                  </span>
                  {item.url && availability.status === 'available' ? (
                    <a
                      className="button small-button"
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open <ArrowUpRight size={14} />
                    </a>
                  ) : null}
                </div>
              ))}
              {result.requests?.[kind] ? (
                <p className="small amber-text">
                  {missingAgain
                    ? 'This copy was available before. Its files are now missing, so you can request it again.'
                    : result.requests[kind]!.following
                      ? 'You’re following this request.'
                      : 'Someone has already requested this format.'}{' '}
                  {['rejected', 'cancelled'].includes(result.requests[kind]!.status)
                    ? 'It is closed; an administrator can reopen it.'
                    : ''}
                </p>
              ) : null}
              {availability.status === 'not_found' ? (
                <button
                  className="button primary full"
                  disabled={
                    busy ||
                    Boolean(result.requests?.[kind]?.following && !missingAgain) ||
                    ['rejected', 'cancelled'].includes(result.requests?.[kind]?.status || '')
                  }
                  onClick={() => void request(kind)}
                >
                  <Plus size={17} />
                  {missingAgain
                    ? 'Request missing copy'
                    : result.requests?.[kind]
                      ? result.requests[kind]!.following
                        ? 'Following request'
                        : 'Follow existing request'
                      : `${user.role === 'admin' || user.autoApprove ? 'Request' : 'Request approval'} ${kind}`}
                </button>
              ) : null}
              {availability.candidates.length ? (
                <div className="candidate-list">
                  <h4>Possible library matches</h4>
                  {availability.candidates.map((item) => (
                    <div className="candidate" key={item.id}>
                      <strong>{item.title}</strong>
                      <small>
                        {item.author} · {item.formats.join(', ')} ·{' '}
                        {item.available ? 'File present' : 'File missing'}
                      </small>
                      {user.role === 'admin' ? (
                        <div className="button-row">
                          <button
                            className="button small-button"
                            disabled={busy}
                            onClick={() => void match(kind, [item.id])}
                          >
                            This is the same book
                          </button>
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() => void match(kind, [item.id], true)}
                          >
                            Different book
                          </button>
                        </div>
                      ) : (
                        <small>Ask an administrator to review this match.</small>
                      )}
                    </div>
                  ))}
                </div>
              ) : null}
              {availability.confirmed && user.role === 'admin' ? (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api(`/matches/${encodeURIComponent(result.book.id)}/${kind}`, 'DELETE');
                      onClose();
                    })
                  }
                >
                  Remove saved identity match
                </button>
              ) : null}
            </section>
          );
        })}
      </div>
      {result.copies && result.copies.length > 1 ? (
        <section className="all-copies">
          <h3>Every copy, one book</h3>
          <p className="muted small">
            These format records share this entry. File presence is the source’s last report;
            current availability is shown above.
          </p>
          {result.copies.map((item) => (
            <div className="copy" key={item.id}>
              <span>
                <strong>{item.title}</strong>
                <small>
                  {item.source === 'bookorbit' ? 'BookOrbit' : 'Chaptarr'} ·{' '}
                  {item.formats.join(', ') || item.mediaKind} ·{' '}
                  {item.available ? 'Last reported present' : 'File missing'}
                </small>
              </span>
            </div>
          ))}
        </section>
      ) : null}
      <p className="dialog-foot">
        <Search size={14} /> Requests check the latest synced inventory again before acquisition.
      </p>
    </dialog>
  );
}
