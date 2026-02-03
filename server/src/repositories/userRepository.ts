import { getDb, saveDatabase } from '../config/database.js'
import bcrypt from 'bcryptjs'

export interface User {
  id: number
  username: string
  password_hash: string
  created_at: string
}

export interface UserWithoutPassword {
  id: number
  username: string
  created_at: string
}

// Find user by username
export function findByUsername(username: string): User | undefined {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM users WHERE username = ?')
  stmt.bind([username])

  if (stmt.step()) {
    const row = stmt.getAsObject() as User
    stmt.free()
    return row
  }

  stmt.free()
  return undefined
}

// Find user by ID
export function findById(id: number): UserWithoutPassword | undefined {
  const db = getDb()
  const stmt = db.prepare('SELECT id, username, created_at FROM users WHERE id = ?')
  stmt.bind([id])

  if (stmt.step()) {
    const row = stmt.getAsObject() as UserWithoutPassword
    stmt.free()
    return row
  }

  stmt.free()
  return undefined
}

// Verify password
export async function verifyPassword(user: User, password: string): Promise<boolean> {
  return bcrypt.compare(password, user.password_hash)
}

// Create user
export async function createUser(username: string, password: string): Promise<UserWithoutPassword> {
  const db = getDb()
  const passwordHash = await bcrypt.hash(password, 10)

  db.run('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, passwordHash])
  saveDatabase()

  // Get the inserted user
  const stmt = db.prepare('SELECT id, username, created_at FROM users WHERE username = ?')
  stmt.bind([username])
  stmt.step()
  const row = stmt.getAsObject() as UserWithoutPassword
  stmt.free()

  return row
}

// Initialize admin user with proper hash (run on server start)
export async function ensureAdminUser(): Promise<void> {
  const admin = findByUsername('admin')

  if (!admin) {
    // Create admin user
    await createUser('admin', 'admin')
    console.log('[UserRepository] Created admin user')
  } else if (!admin.password_hash.startsWith('$2a$') && !admin.password_hash.startsWith('$2b$')) {
    // Update with proper bcrypt hash
    const db = getDb()
    const passwordHash = await bcrypt.hash('admin', 10)
    db.run('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, admin.id])
    saveDatabase()
    console.log('[UserRepository] Updated admin password hash')
  }
}
