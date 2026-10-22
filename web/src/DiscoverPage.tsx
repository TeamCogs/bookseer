import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Compass, Search, Star, TrendingUp, Users } from 'lucide-react';
import type { BookResult } from '../../shared/types';
import {
  discoveryFilters,
  type DiscoveryQuery,
  type DiscoveryResponse,
} from '../../shared/discovery';
import { api, message } from './api';
import { BookGrid } from './Books';

type Props = {
  query: string;
  revision: number;
  select: (book: BookResult) => void;
  browse: () => void;
  discover: () => void;
};
const initialFilters: DiscoveryQuery = {
  topic: '',
  sort: 'trending',
  language: '',
  era: '',
  q: '',
  page: 1,
};

export function DiscoverPage(props: Props) {
  return props.query.trim() ? (
    <SearchResults key={props.query} {...props} />
  ) : (
    <DiscoveryBrowse {...props} />
  );
}

function DiscoveryBrowse({ revision, select, browse }: Props) {
  const [filters, setFilters] = useState(initialFilters);
  const [keywords, setKeywords] = useState('');
  const [data, setData] = useState<DiscoveryResponse>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const results = useRef<HTMLElement>(null);
  const change = (next: DiscoveryQuery) =>
    setFilters((current) => ({ ...current, ...next, page: 1 }));
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const params = new URLSearchParams(
      Object.entries(filters).map(([key, value]) => [key, String(value)]),
    );
    void api<DiscoveryResponse>(`/discover?${params}`, 'GET', undefined, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) setData(response);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [filters, revision, retry]);
  const options = data?.filters || discoveryFilters;
  const curated = data?.mode === 'curated';
  const sample = data?.mode === 'demo';
  const active = Boolean(
    filters.topic || filters.q || filters.language || filters.era || filters.sort !== 'trending',
  );
  const topic = options.topics.find((item) => item.id === filters.topic)?.label;
  const heading = curated
    ? 'Explore the catalogue'
    : sample
      ? 'Explore sample titles'
      : filters.topic
        ? `${topic} to explore`
        : filters.q
          ? `Explore “${filters.q}”`
          : filters.sort === 'popular'
            ? 'On everyone’s reading list'
            : filters.sort === 'rating'
              ? 'Loved by readers'
              : filters.sort === 'new'
                ? 'Recently published'
                : filters.language || filters.era
                  ? 'Trending now'
                  : 'Trending this week';
  const submit = (event: FormEvent) => {
    event.preventDefault();
    change({ q: keywords.trim() });
  };
  const reset = () => {
    setFilters(initialFilters);
    setKeywords('');
  };
  const page = (next: number) => {
    setFilters((current) => ({ ...current, page: next }));
    results.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">BEYOND YOUR SHELVES</p>
          <h1>Discover something new.</h1>
          <p>Follow what’s catching readers’ attention, or follow your curiosity.</p>
        </div>
        <button className="text-button" onClick={browse}>
          Your library <ArrowRight size={16} />
        </button>
      </div>
      {!curated ? (
        <>
          <div className="discovery-collections" aria-label="Browse book collections">
            {[
              {
                id: 'trending',
                title: 'Trending',
                text: 'What’s catching readers’ attention',
                icon: TrendingUp,
              },
              {
                id: 'popular',
                title: 'Most shelved',
                text: 'Books readers keep coming back to',
                icon: Users,
              },
              {
                id: 'rating',
                title: 'Top rated',
                text: 'Reader favorites with 10+ ratings',
                icon: Star,
              },
            ].map(({ id, title, text, icon: Icon }) => (
              <button
                key={id}
                className="collection-card"
                aria-pressed={filters.sort === id}
                onClick={() => change({ sort: id as DiscoveryQuery['sort'] })}
              >
                <Icon size={21} />
                <strong>{title}</strong>
                <span>{text}</span>
                <ArrowRight size={16} />
              </button>
            ))}
          </div>
          <div className="topic-heading">
            <h2>Follow a topic</h2>
            <span className="muted small">Choose a shelf to explore</span>
          </div>
          <div className="topic-chips" aria-label="Book topics">
            {options.topics.map((item) => (
              <button
                key={item.id}
                className="topic-chip"
                aria-pressed={(filters.topic || '') === item.id}
                onClick={() => change({ topic: item.id })}
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      ) : null}
      <details className="discovery-refinement">
        <summary>
          Refine discovery{' '}
          <span>
            {[
              filters.q ? `“${filters.q}”` : '',
              filters.language
                ? options.languages.find((option) => option.id === filters.language)?.label
                : '',
              filters.era ? options.eras.find((option) => option.id === filters.era)?.label : '',
              filters.sort === 'new' ? 'Recently published' : '',
            ]
              .filter(Boolean)
              .join(' · ') ||
              (curated ? 'Browse by keywords' : 'Keywords, language & publication date')}
          </span>
        </summary>
        <form className="discovery-filters" onSubmit={submit}>
          <label className="discovery-keywords">
            Keywords
            <div>
              <Search size={16} aria-hidden="true" />
              <input
                value={keywords}
                maxLength={200}
                placeholder="Space exploration, cooking, adventure…"
                onChange={(event) => setKeywords(event.target.value)}
              />
            </div>
          </label>
          {!curated ? (
            <>
              <Filter
                label="Sort by"
                value={filters.sort || 'trending'}
                options={options.sorts}
                change={(value) => change({ sort: value as DiscoveryQuery['sort'] })}
              />
              <Filter
                label="Language"
                value={filters.language || ''}
                options={options.languages}
                change={(value) => change({ language: value })}
              />
              <Filter
                label="First published"
                value={filters.era || ''}
                options={options.eras}
                change={(value) => change({ era: value as DiscoveryQuery['era'] })}
              />
            </>
          ) : null}
          <button type="submit" className="button primary">
            Explore <ArrowRight size={15} />
          </button>
          {active ? (
            <button type="button" className="text-button" onClick={reset}>
              Clear filters
            </button>
          ) : null}
        </form>
      </details>
      <section className="book-section discovery-results" ref={results} aria-busy={loading}>
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              {sample ? 'SAMPLE CATALOGUE' : curated ? 'CURATED SELECTION' : 'DISCOVER & REQUEST'}
            </p>
            <h2>{heading}</h2>
          </div>
          {!loading && !error && data?.source.url ? (
            <a className="muted small" href={data.source.url} target="_blank" rel="noreferrer">
              {data.source.name} ↗
            </a>
          ) : !loading && !error && data ? (
            <span className="muted small">{data.source.name}</span>
          ) : null}
        </div>
        {error || (!loading && data?.warning) ? (
          <p className="alert" role="status">
            {error || data?.warning}
            <button className="text-button" onClick={() => setRetry((value) => value + 1)}>
              Try again
            </button>
          </p>
        ) : null}
        {loading ? (
          <div className="skeleton-grid" role="status" aria-label="Loading discovery titles">
            {Array.from({ length: 6 }, (_, index) => (
              <div className="skeleton" key={index} />
            ))}
          </div>
        ) : !error && data?.items.length ? (
          <BookGrid results={data.items} select={select} />
        ) : !error && !data?.warning ? (
          <div className="search-prompt">
            <Compass size={26} />
            <p>No titles match these filters. Try another topic or clear a filter.</p>
          </div>
        ) : null}
        {!loading && !error && data?.items.length ? (
          <div className="discovery-pagination">
            <button
              className="button secondary"
              disabled={data.page <= 1}
              onClick={() => page(data.page - 1)}
            >
              Previous
            </button>
            <span className="muted small">
              Page {data.page}
              {data.total !== undefined ? ` · ${data.total.toLocaleString()} titles` : ''}
            </span>
            <button
              className="button secondary"
              disabled={!data.hasMore || data.page >= 100}
              onClick={() => page(data.page + 1)}
            >
              Next page <ArrowRight size={15} />
            </button>
          </div>
        ) : null}
        <p className="muted small discovery-note">
          {sample
            ? 'Sample titles demonstrate discovery without contacting any book services.'
            : curated
              ? 'This server’s operator selects the available titles and formats.'
              : 'Community trends and catalogue metadata from Open Library. Browse lists are the same for everyone. Availability is checked against your connected libraries.'}
        </p>
      </section>
    </>
  );
}
function Filter({
  label,
  value,
  options,
  change,
}: {
  label: string;
  value: string;
  options: { id: string; label: string }[];
  change: (value: string) => void;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => change(event.target.value)}>
        {options.map((option) => (
          <option value={option.id} key={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SearchResults({ query, revision, select, browse, discover }: Props) {
  const [local, setLocal] = useState<BookResult[]>();
  const [online, setOnline] = useState<BookResult[]>();
  const [localError, setLocalError] = useState('');
  const [onlineError, setOnlineError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLocal(undefined);
    setOnline(undefined);
    setLocalError('');
    setOnlineError('');
    for (const scope of ['local', 'online']) {
      void api<{ library: BookResult[]; discovery: BookResult[]; warning?: string }>(
        `/search?q=${encodeURIComponent(query)}&scope=${scope}`,
        'GET',
        undefined,
        controller.signal,
      )
        .then((response) => {
          if (controller.signal.aborted) return;
          if (scope === 'local') setLocal(response.library);
          else {
            setOnline(response.discovery);
            setOnlineError(response.warning || '');
          }
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          if (scope === 'local') {
            setLocal([]);
            setLocalError(message(error));
          } else {
            setOnline([]);
            setOnlineError(message(error));
          }
        });
    }
    return () => controller.abort();
  }, [query, revision, retry]);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">FIND & REQUEST</p>
          <h1>Results for “{query}”</h1>
          <p>Your connected shelves come first. Request the formats you’re missing.</p>
        </div>
        <button className="text-button" onClick={discover}>
          Back to discovery <ArrowRight size={16} />
        </button>
      </div>
      {[
        { title: 'In your library', items: local, error: localError },
        { title: 'Discover & request', items: online, error: onlineError },
      ].map((section, index) => (
        <section className="book-section" key={section.title}>
          <div className="section-heading">
            <h2>{section.title}</h2>
            {index === 0 ? (
              <button className="text-button" onClick={browse}>
                View library <ArrowRight size={16} />
              </button>
            ) : null}
          </div>
          {section.error ? (
            <p className="alert" role="status">
              {section.error}{' '}
              <button className="text-button" onClick={() => setRetry((value) => value + 1)}>
                Try again
              </button>
            </p>
          ) : null}
          {section.items === undefined ? (
            <p className="muted" role="status">
              Searching {index ? 'the online catalogue' : 'your library'}…
            </p>
          ) : section.items.length ? (
            <BookGrid results={section.items} select={select} />
          ) : !section.error ? (
            <p className="muted">
              {index
                ? 'No online matches. Try the title and author together.'
                : 'No exact library matches. Online results also check related copies.'}
            </p>
          ) : null}
        </section>
      ))}
    </>
  );
}
