"use client";

// DataErrorBoundary — visible error card for failed RPC fetches.
//
// Use this together with `useRpcResult` (or any equivalent fetch hook that
// returns `{ data, loading, error, refetch }`) so that silent `try/catch + return []`
// patterns no longer hide failures in production.
//
//   const { data, loading, error, refetch } = useRpcResult(() => rpcGetX(), [deps], []);
//   return (
//     <DataErrorBoundary error={error} loading={loading} retry={refetch}>
//       <MyChart data={data} />
//     </DataErrorBoundary>
//   );
//
// Behaviour:
//   - error != null  → renders an error card (children are NOT rendered).
//   - error == null  → renders children (the chart/table/etc).
//   - emptyState     → optional fallback rendered when `error == null && !loading`
//                       AND a caller-provided predicate signals "no data". Most
//                       dashboards will instead render their own empty card
//                       inside children — this prop is just a convenience.
//   - retry          → if provided, the card shows a "Tentar novamente" button
//                       wired to it.
//
// Visual tokens follow the project identity guide:
//   - Border:   #dc3545 (Bootstrap "danger" red — matches alert subsystem).
//   - Padding:  generous, centered.
//   - Title:    Arial, dark grey.
//   - Body:     dev mode shows error.message verbatim; prod mode shows a
//               generic message + "console" hint.
//
// Owned by: worker_subgerente-app. Each worker_dash-* may consume but should not
// edit this file directly — request changes via the subgerente.

import type { ReactNode } from "react";

export interface DataErrorBoundaryProps {
  /** Latest fetch error, or null when fetch succeeded. */
  error: Error | null;
  /** Used purely for prop documentation today; kept so callers can keep one wire. */
  loading?: boolean;
  /** Rendered when `error` is null. */
  children: ReactNode;
  /** Optional fallback rendered when `error == null && loading == false` and
   *  the caller wants this component to also handle the "no data" branch.
   *  Most dashboards skip this and render their own empty state inside `children`. */
  emptyState?: ReactNode;
  /** Optional callback wired to the "Try again" button. */
  retry?: () => void;
}

const isDev =
  typeof process !== "undefined" && process.env?.NODE_ENV !== "production";

export default function DataErrorBoundary({
  error,
  loading = false,
  children,
  emptyState,
  retry,
}: DataErrorBoundaryProps) {
  if (error != null) {
    return (
      <div
        role="alert"
        aria-live="polite"
        style={{
          border: "2px solid #dc3545",
          borderRadius: 8,
          padding: "32px 24px",
          margin: "24px 0",
          background: "#fff5f5",
          color: "#212529",
          fontFamily: "Arial, sans-serif",
          textAlign: "center",
          maxWidth: 720,
          marginLeft: "auto",
          marginRight: "auto",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            fontSize: 36,
            lineHeight: 1,
            marginBottom: 12,
            color: "#dc3545",
            fontWeight: 700,
          }}
        >
          !
        </div>
        <div
          style={{
            fontSize: 18,
            fontWeight: 600,
            marginBottom: 8,
            color: "#212529",
          }}
        >
          Failed to load data
        </div>
        <div
          style={{
            fontSize: 13,
            color: "#555",
            marginBottom: retry ? 16 : 0,
            wordBreak: "break-word",
          }}
        >
          {isDev
            ? error.message || "Unknown error."
            : "Technical details available in the console."}
        </div>
        {retry && (
          <button
            type="button"
            onClick={retry}
            style={{
              background: "#dc3545",
              color: "#fff",
              border: "none",
              borderRadius: 4,
              padding: "8px 20px",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
              fontFamily: "Arial, sans-serif",
            }}
          >
            Try again
          </button>
        )}
      </div>
    );
  }

  if (emptyState != null && !loading) {
    return <>{emptyState}</>;
  }

  return <>{children}</>;
}
