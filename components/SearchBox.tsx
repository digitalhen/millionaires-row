'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SearchMode, SearchResponse, SearchResult } from '@/lib/types';
import { withBase } from '@/lib/basePath';
import { boroName, money } from '@/lib/format';
import { EligibleMark, NotOnRollNote } from './EligibleBadge';

const MODES: { key: SearchMode; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'owner', label: 'Owner' },
  { key: 'address', label: 'Address' },
];

const MIN_CHARS = 3;
const DEBOUNCE_MS = 200;
const LIMIT = 10;

export default function SearchBox({
  autoFocus = false,
  onSelect,
}: {
  autoFocus?: boolean;
  /** When supplied, choosing a result hands it to the caller (the home page
   *  opens the details panel) instead of navigating to the property page. */
  onSelect?: (result: SearchResult) => void;
}) {
  const router = useRouter();
  const listId = useId();
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<SearchMode>('all');
  const [data, setData] = useState<SearchResponse | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < MIN_CHARS) {
      setData(null);
      setBusy(false);
      return;
    }
    const ac = new AbortController();
    setBusy(true);
    const t = setTimeout(() => {
      fetch(
        withBase(`/api/search?q=${encodeURIComponent(term)}&mode=${mode}&limit=${LIMIT}`),
        { signal: ac.signal },
      )
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d: SearchResponse) => {
          setData(d);
          setActive(-1);
          setBusy(false);
        })
        .catch((err) => {
          if (err?.name !== 'AbortError') setBusy(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      ac.abort();
      clearTimeout(t);
    };
  }, [q, mode]);

  // Close the dropdown on an outside click.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const results = data?.results ?? [];

  function go(r: SearchResult) {
    setOpen(false);
    if (onSelect) {
      onSelect(r);
      return;
    }
    router.push(`/property/${encodeURIComponent(r.parid)}`);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!results.length) return;
      e.preventDefault();
      setOpen(true);
      setActive((i) => {
        const next = e.key === 'ArrowDown' ? i + 1 : i - 1;
        if (next < 0) return results.length - 1;
        if (next >= results.length) return 0;
        return next;
      });
      return;
    }
    if (e.key === 'Enter') {
      const pick = results[active >= 0 ? active : 0];
      if (pick) {
        e.preventDefault();
        go(pick);
      }
    }
  }

  const term = q.trim();
  const showPanel = open && term.length > 0;

  return (
    <div className="search" ref={boxRef}>
      <div className="search-row">
        <input
          type="search"
          value={q}
          autoFocus={autoFocus}
          spellCheck={false}
          autoComplete="off"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-autocomplete="list"
          placeholder="Search owner or address"
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        <div className="search-modes" role="group" aria-label="Search mode">
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              aria-pressed={mode === m.key}
              onClick={() => setMode(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {showPanel && (
        <div className="search-results" id={listId} role="listbox">
          {term.length < MIN_CHARS ? (
            <div className="search-hint">Type at least {MIN_CHARS} characters</div>
          ) : busy && !results.length ? (
            <div className="search-hint">Searching…</div>
          ) : !results.length ? (
            <div className="search-empty">No matches</div>
          ) : (
            <>
              {results.map((r, i) => (
                <a
                  key={r.parid}
                  href={withBase(`/property/${encodeURIComponent(r.parid)}`)}
                  role="option"
                  aria-selected={i === active}
                  className={`result${i === active ? ' active' : ''}`}
                  onClick={(e) => {
                    e.preventDefault();
                    go(r);
                  }}
                  onMouseEnter={() => setActive(i)}
                >
                  <div className="result-top">
                    <span className="result-addr">
                      {r.eligible && <EligibleMark />}
                      {r.address}
                    </span>
                    <span className="result-fmv">{money(r.fmv)}</span>
                  </div>
                  <div className="result-sub">
                    <span className="result-owner">{r.owner || 'No owner on file'}</span>
                    <span>· {boroName(r.boro)}</span>
                    {r.property_count > 1 && (
                      <span className="badge">▣ {r.property_count} properties</span>
                    )}
                    {!r.on_supplemental && <NotOnRollNote inline />}
                  </div>
                </a>
              ))}
              {data && data.total > results.length && (
                <div className="search-hint">
                  {data.total.toLocaleString()}
                  {data.totalCapped ? '+' : ''} matches — refine to narrow
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
