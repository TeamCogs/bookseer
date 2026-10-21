import type { RequestStatus } from './types.js';
export function readerRequestMessage(status: RequestStatus, detail: string): string {
  const messages: Partial<Record<RequestStatus, string>> = {
    pending_setup: 'Approved. Your library administrator is preparing acquisition.',
    checking: 'Checking for copies you already have before continuing.',
    pending_metadata: 'Waiting for book details from the acquisition service.',
    pending_upstream: 'The acquisition service is preparing this title.',
    submitting: 'Your verified request is being sent.',
    requested: 'Your request is queued for acquisition.',
    downloading: 'Your book is downloading.',
    importing: 'Your book is being added to the library.',
    available: 'Your book is available in the library.',
    needs_review: 'A library administrator is reviewing this request before it can continue.',
    failed: 'Your request needs administrator attention.',
  };
  return messages[status] || detail;
}
