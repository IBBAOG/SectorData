# Claude Instructions

This project uses a **non-standard Next.js version (16.2.1)** with breaking changes from training data.
Before writing any Next.js code, read the relevant guide in `node_modules/next/dist/docs/`.
Heed all deprecation notices — APIs, conventions, and file structure may differ significantly.

This repo follows a **departmental agent organization**. Before non-trivial work, read `docs/master.md`
to know which agent (`worker_*`) owns the file you're editing and which contracts cross departments.
For any change touching a single dashboard, also read `docs/app/<dashboard>.md`. For schema changes,
read `docs/supabase/PRD.md`. For visual changes, read `docs/design/identity.md`.

@README.md
