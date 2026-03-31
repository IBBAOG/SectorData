import fs from "fs";

const env = fs.readFileSync(".env", "utf8");
const url = env.match(/SUPABASE_URL=(.*)/)[1].trim();
const key = env.match(/SUPABASE_SERVICE_KEY=(.*)/)[1].trim();
const projectRef = url.match(/https:\/\/(.+?)\.supabase\.co/)[1];

const migrationSQL = fs.readFileSync(
  "sql/create_profiles_and_visibility.sql",
  "utf8"
);

async function tryEndpoint(endpoint, headers) {
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ query: migrationSQL }),
  });
  const text = await resp.text();
  return { ok: resp.ok, status: resp.status, body: text };
}

async function main() {
  console.log("Deploying profiles + module_visibility migration...\n");

  // Approach 1: Supabase pg-meta API (works on some project tiers)
  console.log("Trying pg-meta API...");
  const r1 = await tryEndpoint(`${url}/pg/query`, {
    apikey: key,
    Authorization: `Bearer ${key}`,
  }).catch((e) => ({ ok: false, body: e.message }));

  if (r1.ok) {
    console.log("✅ Migration deployed via pg-meta API!");
    return;
  }
  console.log(`  → Failed (${r1.status}): ${r1.body.substring(0, 120)}`);

  // Approach 2: Supabase Management API (requires PAT — may fail)
  console.log("Trying Supabase Management API...");
  const r2 = await tryEndpoint(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    { Authorization: `Bearer ${key}` }
  ).catch((e) => ({ ok: false, body: e.message }));

  if (r2.ok) {
    console.log("✅ Migration deployed via Management API!");
    return;
  }
  console.log(`  → Failed (${r2.status}): ${r2.body.substring(0, 120)}`);

  // Nothing worked — print instructions
  console.log(`
⚠️  Automated deployment unavailable. Please run the migration manually:

  1. Open: https://supabase.com/dashboard/project/${projectRef}/sql/new
  2. Paste the contents of: sql/create_profiles_and_visibility.sql
  3. Click "Run"

Then insert test profile rows (replace UUIDs with real ones from Auth → Users):

  INSERT INTO public.profiles (id, role, full_name)
  VALUES
    ('<admin-uuid>', 'Admin', 'Test Admin'),
    ('<client-uuid>', 'Client', 'Test Client');
`);
}

main();
