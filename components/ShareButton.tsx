'use client';

import { useState } from 'react';
import { SITE_URL, withBase } from '../lib/basePath';

/**
 * Share a page. Native share sheet where the browser has one (phones),
 * copy-to-clipboard everywhere else. `path` is the canonical app path
 * ('/property/…'); shared URLs always use the production origin so a link
 * copied from a dev box still points somewhere real.
 */
export default function ShareButton({
  path,
  title,
  text,
}: {
  path: string;
  title: string;
  /** One-to-two sentence summary included with the share / copied above the link. */
  text?: string;
}) {
  const [copied, setCopied] = useState(false);

  const url =
    typeof window !== 'undefined' && window.location.origin.includes('localhost')
      ? `${SITE_URL}${withBase(path)}`
      : typeof window !== 'undefined'
        ? `${window.location.origin}${withBase(path)}`
        : `${SITE_URL}${withBase(path)}`;

  const clipboardPayload = text ? `${text}\n${url}` : url;

  async function share() {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch {
        // Dismissed the sheet, or share failed — fall through to copy.
      }
    }
    try {
      await navigator.clipboard.writeText(clipboardPayload);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (rare) — show it so it can be copied by hand.
      window.prompt('Copy', clipboardPayload);
    }
  }

  return (
    <button type="button" className="badge share-btn" onClick={share} aria-label={`Share ${title}`}>
      {copied ? 'Link copied ✓' : 'Share ↗'}
    </button>
  );
}
