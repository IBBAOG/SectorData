"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useDebounce } from "../../hooks/useDebounce";
import type { StockSearchResult } from "../../types/stocks";

interface Props {
  onSelect: (symbol: string, name: string) => void;
  placeholder?: string;
}

export default function StockSearch({ onSelect, placeholder = "Buscar ação..." }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StockSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const debouncedQuery = useDebounce(query, 150);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch search results
  useEffect(() => {
    if (!debouncedQuery || debouncedQuery.length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    fetch(`/api/stocks/search?q=${encodeURIComponent(debouncedQuery)}`)
      .then((res) => res.json())
      .then((data: StockSearchResult[]) => {
        if (!cancelled) {
          setResults(data);
          setIsOpen(data.length > 0);
          setActiveIndex(-1);
        }
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [debouncedQuery]);

  // Close on click outside
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const handleSelect = useCallback(
    (item: StockSearchResult) => {
      onSelect(item.symbol, item.shortName);
      setQuery("");
      setResults([]);
      setIsOpen(false);
    },
    [onSelect],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      handleSelect(results[activeIndex]);
    } else if (e.key === "Escape") {
      setIsOpen(false);
    }
  };

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <div style={{ position: "relative" }}>
        <input
          type="text"
          className="form-control"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value.toUpperCase())}
          onKeyDown={handleKeyDown}
          onFocus={() => results.length > 0 && setIsOpen(true)}
          style={{ paddingLeft: 36 }}
        />
        <span
          style={{
            position: "absolute",
            left: 10,
            top: "50%",
            transform: "translateY(-50%)",
            color: "#888",
            fontSize: 16,
          }}
        >
          {isLoading ? (
            <span
              className="spinner-border spinner-border-sm"
              role="status"
              style={{ width: 16, height: 16 }}
            />
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M11.742 10.344a6.5 6.5 0 10-1.397 1.398h-.001l3.85 3.85a1 1 0 001.415-1.414l-3.85-3.85zm-5.242.156a5 5 0 110-10 5 5 0 010 10z" />
            </svg>
          )}
        </span>
      </div>

      {isOpen && results.length > 0 && (
        <ul
          className="list-group"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 1050,
            maxHeight: 280,
            overflowY: "auto",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            borderRadius: 8,
            marginTop: 4,
          }}
        >
          {results.map((item, idx) => (
            <li
              key={item.symbol}
              className={`list-group-item list-group-item-action${idx === activeIndex ? " active" : ""}`}
              style={{ cursor: "pointer", padding: "8px 12px" }}
              onMouseEnter={() => setActiveIndex(idx)}
              onClick={() => handleSelect(item)}
            >
              <strong style={{ marginRight: 8 }}>{item.symbol}</strong>
              <span style={{ fontSize: 13, color: idx === activeIndex ? "#fff" : "#666" }}>
                {item.shortName}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
