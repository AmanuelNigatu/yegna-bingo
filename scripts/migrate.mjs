import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';

const { Client } = pg;
const root = process.cwd();
const dbDir = path.join(root, 'db');
const argv = new Set(process.argv.slice(2));
const targetArg = process.argv.find((x) => x.startsWith('--to='));
const target = targetArg ? Number(targetArg.slice(5)) : Infinity;
const baselineArg = process.argv.find((x) => x.startsWith('--baseline='));
const baseline = baselineArg ? Number(baselineArg.slice(11)) : null;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required.');
  process.exit(2);
}
if (!Number.isInteger(target) && target !== Infinity) {
  console.error('--to must be an integer version.');
  process.exit(2);
}
if (baseline !== null && (!Number.isInteger(baseline) || baseline < 0)) {
  console.error('--baseline must be a non-negative integer version.');
  process.exit(2);
}

async function main() {
  const files = (await fs.readdir(dbDir))
    .filter((name) => /^migration-v\d+\.sql$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));

  const migrations = [];
  for (const file of files) {
    const version = Number(file.match(/\d+/)[0]);
    const sql = await fs.readFile(path.join(dbDir, file), 'utf8');
    migrations.push({ version, file, sql, checksum: crypto.createHash('sha256').update(sql).digest('hex') });
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'disable' ? false : { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    await client.query('SELECT pg_advisory_lock($1)', [49049]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        filename TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const appliedResult = await client.query(
      'SELECT version, filename, checksum, applied_at FROM schema_migrations ORDER BY version'
    );
    const applied = new Map(appliedResult.rows.map((r) => [Number(r.version), r]));

    for (const m of migrations) {
      if (applied.has(m.version) && applied.get(m.version).checksum !== m.checksum) {
        throw new Error(`Migration v${m.version} checksum mismatch for ${m.file}; migrations are immutable.`);
      }
    }

    if (argv.has('--status')) {
      console.log('Migration status:');
      for (const m of migrations) {
        console.log(`v${m.version}\t${applied.has(m.version) ? 'APPLIED' : 'PENDING'}\t${m.file}`);
      }
      return;
    }

    if (baseline !== null) {
      if (!argv.has('--confirm-baseline')) {
        throw new Error(
          'Baseline requires --confirm-baseline after manually verifying the database.'
        );
      }
      for (const m of migrations.filter((x) => x.version <= baseline)) {
        if (!applied.has(m.version)) {
          await client.query(
            'INSERT INTO schema_migrations(version, filename, checksum) VALUES($1,$2,$3)',
            [m.version, m.file, m.checksum]
          );
          console.log(`Baselined v${m.version}: ${m.file}`);
        }
      }
      return;
    }

    const pending = migrations.filter((m) => m.version <= target && !applied.has(m.version));
    if (!pending.length) {
      console.log('Database is up to date.');
      return;
    }

    for (const m of pending) {
      await client.query('BEGIN');
      try {
        await client.query(m.sql);
        await client.query(
          'INSERT INTO schema_migrations(version, filename, checksum) VALUES($1,$2,$3)',
          [m.version, m.file, m.checksum]
        );
        await client.query('COMMIT');
        console.log(`Applied v${m.version}: ${m.file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration v${m.version} failed: ${err.message}`);
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [49049]).catch(() => {});
    await client.end();
  }
}

main().catch((err) => {
  console.error(`Migration runner failed: ${err.message}`);
  process.exit(1);
});
