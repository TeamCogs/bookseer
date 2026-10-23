import type { CatalogBook, ChaptarrMatchCandidate, MediaKind } from '../../shared/types.js';
import {
  compatibleAuthorNames,
  compatibleExtent,
  identifiers,
  normalizeAuthor,
  normalizeText,
} from '../matching.js';

export type MatchInput = { book: Record<string, any>; canonical?: boolean };
export type RankedMatch = { book: Record<string, any>; summary: ChaptarrMatchCandidate };
const workId = /^(ol:|hc:|gr:|gb:)/;

function workIdentifiers(candidate: Record<string, any>): string[] {
  return identifiers(
    [],
    [
      candidate.foreignBookId,
      ...[
        ['ol', candidate.openLibraryWorkId],
        ['hc', candidate.hardcoverBookId],
        ['gr', candidate.goodreadsWorkId],
      ].map(([prefix, value]) =>
        typeof value === 'string' && value
          ? value.startsWith(prefix + ':')
            ? value
            : `${prefix}:${value}`
          : undefined,
      ),
    ],
  ).work;
}

function mainTitle(title: string): string {
  return normalizeText(title.split(/[:;]|\s[—–-]\s/)[0]);
}

function derivative(title: string): string {
  const text = normalizeText(title);
  return /\b(summary|summaries|study guide|workbook|analysis of|abridged)\b/.exec(text)?.[0] || '';
}

/** Rank evidence, never popularity. Provider order is only a final cross-provider tie-break. */
export function rankChaptarrMatches(
  requested: CatalogBook,
  kind: MediaKind,
  inputs: MatchInput[],
  confirmedWorkId?: string,
): RankedMatch[] {
  const matches = new Map<string, RankedMatch>();
  for (const input of inputs) {
    const candidate = input.book;
    if (!candidate || typeof candidate.title !== 'string') continue;
    const title = candidate.title;
    const author = candidate.author?.authorName || candidate.author?.name || '';
    const ids = workIdentifiers(candidate);
    const sameWork = ids.some((id) => requested.identifiers.work.includes(id));
    const pinned = Boolean(confirmedWorkId && ids.includes(confirmedWorkId));
    const sameAuthor = normalizeAuthor(author) === normalizeAuthor(requested.author);
    if (
      !normalizeAuthor(requested.author) ||
      !normalizeText(requested.title) ||
      (!sameAuthor && !(input.canonical && compatibleAuthorNames(author, requested.author))) ||
      !compatibleExtent(requested.title, title) ||
      derivative(requested.title) !== derivative(title) ||
      (candidate.isOmnibus === true &&
        !/\b(collection|omnibus|boxed? set)\b/i.test(requested.title))
    )
      continue;
    const exactTitle = normalizeText(title) === normalizeText(requested.title);
    const subtitle = mainTitle(title) === mainTitle(requested.title);
    // A canonical lookup can establish aliases and title variants, but cannot waive author/extent checks.
    if (!exactTitle && !subtitle) continue;
    const editionList = Array.isArray(candidate.editions) ? candidate.editions : [];
    const isbns = identifiers(
      editionList.flatMap((e: any) => [e.isbn13, e.isbn10, e.isbn]),
      [],
    ).isbn;
    const sharedIsbn = isbns.some((isbn) => requested.identifiers.isbn.includes(isbn));
    const primaryWork = workId.test(requested.id) && ids.includes(requested.id);
    const provider = ids.some((id) => id.startsWith('gr:'))
      ? 'Goodreads'
      : ids.some((id) => id.startsWith('hc:'))
        ? 'Hardcover'
        : ids.some((id) => id.startsWith('ol:'))
          ? 'Open Library'
          : 'Chaptarr';
    const local =
      (kind === 'ebook' ? candidate.localEbookBooks : candidate.localAudiobookBooks) || [];
    const owned = local.some((b: any) => Number.isSafeInteger(b.id) && b.hasFiles);
    const rank = pinned ? 1000 : sharedIsbn ? 900 : primaryWork ? 800 : 600;
    const reasons = [
      pinned
        ? 'Saved book identity'
        : sharedIsbn
          ? 'Matching ISBN'
          : primaryWork
            ? 'Matching source work ID'
            : exactTitle
              ? 'Matching title and author'
              : 'Matching title, subtitle, and author',
    ];
    if (input.canonical) reasons.push('validated work lookup');
    if (owned) reasons.push('existing library file');
    // Goodreads precedes Hardcover for equivalent text evidence, matching Chaptarr's native import catalogue.
    const score =
      rank +
      (owned ? 50 : 0) +
      (provider === 'Goodreads' ? 30 : provider === 'Hardcover' ? 20 : 10);
    const foreignId =
      typeof candidate.foreignBookId === 'string' ? candidate.foreignBookId : ids[0] || '';
    const key = foreignId || `${normalizeText(title)}|${normalizeAuthor(author)}`;
    const match: RankedMatch = {
      book: candidate,
      summary: {
        workId: foreignId,
        title,
        author,
        provider,
        score,
        reason: reasons.join('; '),
        isbns,
        localIds: local
          .filter((b: any) => Number.isSafeInteger(b.id) && b.id > 0)
          .map((b: any) => b.id),
      },
    };
    const previous = matches.get(key);
    if (
      !previous ||
      score > previous.summary.score ||
      (score === previous.summary.score &&
        editionList.length > (previous.book.editions?.length || 0))
    )
      matches.set(key, match);
  }
  return [...matches.values()].sort(
    (a, b) => b.summary.score - a.summary.score || a.summary.workId.localeCompare(b.summary.workId),
  );
}

export function uniqueChaptarrMatch(
  matches: RankedMatch[],
  confirmedWorkId?: string,
): RankedMatch | undefined {
  if (confirmedWorkId) return matches.find((m) => m.summary.workId === confirmedWorkId);
  return matches.length &&
    (matches.length === 1 || matches[0].summary.score > matches[1].summary.score)
    ? matches[0]
    : undefined;
}
