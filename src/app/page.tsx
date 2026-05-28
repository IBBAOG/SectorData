// Root route (`/`) — server-side redirect to `/home`.
//
// Without this file, Next.js 16 has no segment to render at `/` (the home
// dashboard lives at `(dashboard)/home`) and falls through to the global
// error boundary ("This page couldn't load — Reload to try again").
//
// `/home` is Anon-friendly: `(dashboard)/layout.tsx` no longer forces
// `/login`, so anonymous visitors landing on the bare domain are taken
// straight to the public module gallery. The visitor cookie issued by
// `src/proxy.ts` runs BEFORE this redirect (matcher includes `/`) and is
// preserved across the 307, so anon analytics are not lost.
import { redirect } from "next/navigation";

export default function RootPage() {
  redirect("/home");
}
