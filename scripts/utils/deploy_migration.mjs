import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const env = fs.readFileSync(".env", "utf8");
const url = env.match(/SUPABASE_URL=(.*)/)[1].trim();
const key = env.match(/SUPABASE_SERVICE_KEY=(.*)/)[1].trim();

const supabase = createClient(url, key, {
  db: { schema: "public" },
  auth: { persistSession: false },
});

// We can't run raw SQL via supabase-js, but we CAN use the
// Supabase Management API's SQL query endpoint
// Format: POST https://<project-ref>.supabase.co/rest/v1/rpc/...
// Since that's not available, let's use fetch to the pg-meta endpoint

const projectRef = url.match(/https:\/\/(.+?)\.supabase\.co/)[1];

async function execSQL(sql) {
  // Use the Supabase pg-meta API (internal, but accessible with service key)
  const resp = await fetch(
    `${url}/pg/query`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
        "X-Connection-Encrypted": "true",
      },
      body: JSON.stringify({ query: sql }),
    }
  );

  if (!resp.ok) {
    // Try alternate endpoint
    const resp2 = await fetch(
      `https://${projectRef}.supabase.co/pg/query`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ query: sql }),
      }
    );
    if (!resp2.ok) {
      throw new Error(`SQL exec failed: ${resp2.status} ${await resp2.text()}`);
    }
    return resp2.json();
  }
  return resp.json();
}

async function main() {
  const migrationSQL = fs.readFileSync(
    "supabase/migrations/20260328200000_navios_diesel.sql",
    "utf8"
  );

  console.log("Deploying navios_diesel migration...");

  try {
    const result = await execSQL(migrationSQL);
    console.log("✅ Migration deployed successfully!", result);
  } catch (e) {
    console.error("❌ pg-meta approach failed:", e.message);
    console.log("\nTrying statement-by-statement via supabase-js...");

    // Fallback: split into statements and try via individual DDL
    // This won't work for all statements but let's try CREATE TABLE
    // through the admin API

    // Last resort: use the database.sql endpoint
    try {
      const resp = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ query: migrationSQL }),
      });

      if (resp.ok) {
        console.log("✅ Migration deployed via Management API!");
      } else {
        const text = await resp.text();
        console.error("Management API failed:", resp.status, text.substring(0, 300));
        console.log("\n⚠️  Please run the migration manually:");
        console.log("1. Go to https://supabase.com/dashboard/project/" + projectRef + "/sql");
        console.log("2. Paste the contents of: supabase/migrations/20260328200000_navios_diesel.sql");
        console.log("3. Click 'Run'");
      }
    } catch (e2) {
      console.error("All approaches failed:", e2.message);
      console.log("\n⚠️  Please run the migration manually:");
      console.log("1. Go to https://supabase.com/dashboard/project/" + projectRef + "/sql");
      console.log("2. Paste the contents of: supabase/migrations/20260328200000_navios_diesel.sql");
      console.log("3. Click 'Run'");
    }
  }
}

main();
