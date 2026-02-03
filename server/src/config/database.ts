import initSqlJs, { Database } from 'sql.js'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Database file path
const DATA_DIR = join(__dirname, '../../data')
const DB_PATH = join(DATA_DIR, 'lbo.db')

// Ensure data directory exists
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true })
}

let db: Database

// Initialize database
export async function initDatabase(): Promise<Database> {
  const SQL = await initSqlJs()

  // Load existing database or create new one
  if (existsSync(DB_PATH)) {
    const buffer = readFileSync(DB_PATH)
    db = new SQL.Database(buffer)
    console.log('[Database] Loaded existing database from', DB_PATH)
  } else {
    db = new SQL.Database()
    console.log('[Database] Created new database')
  }

  // Run migrations
  runMigrations()

  return db
}

// Save database to file
export function saveDatabase(): void {
  if (!db) return
  const data = db.export()
  const buffer = Buffer.from(data)
  writeFileSync(DB_PATH, buffer)
}

// Auto-save on process exit
process.on('exit', () => {
  saveDatabase()
})

process.on('SIGINT', () => {
  saveDatabase()
  process.exit(0)
})

process.on('SIGTERM', () => {
  saveDatabase()
  process.exit(0)
})

// Run migrations
function runMigrations(): void {
  console.log('[Database] Running migrations...')

  // Create migrations tracking table if it doesn't exist
  db.run(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      applied_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `)

  const migrationsDir = join(__dirname, '../migrations')

  if (!existsSync(migrationsDir)) {
    console.warn('[Database] No migrations directory found')
    return
  }

  // Get all .sql files and sort them
  const migrationFiles = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort()

  for (const file of migrationFiles) {
    // Check if migration has already been applied
    const result = db.exec(`SELECT name FROM _migrations WHERE name = '${file}'`)
    if (result.length > 0 && result[0].values.length > 0) {
      console.log(`[Database] Skipping migration (already applied): ${file}`)
      continue
    }

    const migrationPath = join(migrationsDir, file)
    console.log(`[Database] Running migration: ${file}`)
    const sql = readFileSync(migrationPath, 'utf-8')

    try {
      db.run(sql)
      // Record that migration was applied
      db.run(`INSERT INTO _migrations (name) VALUES ('${file}')`)
    } catch (error) {
      // If error is about duplicate column, mark as applied anyway
      const errorMessage = (error as Error).message
      if (errorMessage.includes('duplicate column')) {
        console.log(`[Database] Migration ${file} - column already exists, marking as applied`)
        db.run(`INSERT OR IGNORE INTO _migrations (name) VALUES ('${file}')`)
      } else {
        throw error
      }
    }
  }

  saveDatabase()
  console.log('[Database] Migrations complete')
}

// Get database instance
export function getDb(): Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return db
}

export default { initDatabase, getDb, saveDatabase }
