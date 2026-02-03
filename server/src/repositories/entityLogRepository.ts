import { getDb, saveDatabase } from '../config/database.js'

export interface EntityLog {
  id: number
  user_id: number
  normalized_text: string
  label: string
  original_text: string
  is_active: number // 1=anonymized, 0=de-anonymized
  created_at: string
}

export interface CreateEntityLogInput {
  userId: number
  normalizedText: string
  label: string
  originalText: string
  isActive?: boolean
}

export interface UpdateEntityLogInput {
  label?: string
  isActive?: boolean
}

// Get all entity logs for a user
export function findByUserId(userId: number): EntityLog[] {
  const db = getDb()
  const stmt = db.prepare(`
    SELECT id, user_id, normalized_text, label, original_text, is_active, created_at
    FROM entity_log
    WHERE user_id = ?
    ORDER BY created_at DESC
  `)
  stmt.bind([userId])

  const results: EntityLog[] = []
  while (stmt.step()) {
    results.push(stmt.getAsObject() as EntityLog)
  }
  stmt.free()

  return results
}

// Get active entity logs for a user (for auto-applying)
export function findActiveByUserId(userId: number): EntityLog[] {
  const db = getDb()
  const stmt = db.prepare(`
    SELECT id, user_id, normalized_text, label, original_text, is_active, created_at
    FROM entity_log
    WHERE user_id = ? AND is_active = 1
    ORDER BY created_at DESC
  `)
  stmt.bind([userId])

  const results: EntityLog[] = []
  while (stmt.step()) {
    results.push(stmt.getAsObject() as EntityLog)
  }
  stmt.free()

  return results
}

// Get a specific entity log by ID
export function findById(id: number): EntityLog | undefined {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM entity_log WHERE id = ?')
  stmt.bind([id])

  if (stmt.step()) {
    const row = stmt.getAsObject() as EntityLog
    stmt.free()
    return row
  }

  stmt.free()
  return undefined
}

// Find entity log by normalized text for a user
export function findByNormalizedText(userId: number, normalizedText: string): EntityLog | undefined {
  const db = getDb()
  const stmt = db.prepare(`
    SELECT * FROM entity_log
    WHERE user_id = ? AND normalized_text = ?
  `)
  stmt.bind([userId, normalizedText])

  if (stmt.step()) {
    const row = stmt.getAsObject() as EntityLog
    stmt.free()
    return row
  }

  stmt.free()
  return undefined
}

// Create a new entity log entry (or update if exists)
export function upsert(input: CreateEntityLogInput): EntityLog {
  const db = getDb()

  // Check if entry already exists
  const existing = findByNormalizedText(input.userId, input.normalizedText)

  if (existing) {
    // Update existing entry
    db.run(`
      UPDATE entity_log
      SET label = ?, original_text = ?, is_active = ?
      WHERE id = ?
    `, [
      input.label,
      input.originalText,
      input.isActive !== false ? 1 : 0,
      existing.id
    ])
    saveDatabase()

    return {
      ...existing,
      label: input.label,
      original_text: input.originalText,
      is_active: input.isActive !== false ? 1 : 0
    }
  }

  // Insert new entry
  db.run(`
    INSERT INTO entity_log (user_id, normalized_text, label, original_text, is_active)
    VALUES (?, ?, ?, ?, ?)
  `, [
    input.userId,
    input.normalizedText,
    input.label,
    input.originalText,
    input.isActive !== false ? 1 : 0
  ])

  saveDatabase()

  // Get the last inserted row ID
  const stmt = db.prepare('SELECT last_insert_rowid() as id')
  stmt.step()
  const { id } = stmt.getAsObject() as { id: number }
  stmt.free()

  return {
    id,
    user_id: input.userId,
    normalized_text: input.normalizedText,
    label: input.label,
    original_text: input.originalText,
    is_active: input.isActive !== false ? 1 : 0,
    created_at: new Date().toISOString()
  }
}

// Update an entity log entry
export function update(id: number, input: UpdateEntityLogInput): boolean {
  const db = getDb()

  const existing = findById(id)
  if (!existing) return false

  const updates: string[] = []
  const params: (string | number)[] = []

  if (input.label !== undefined) {
    updates.push('label = ?')
    params.push(input.label)
  }

  if (input.isActive !== undefined) {
    updates.push('is_active = ?')
    params.push(input.isActive ? 1 : 0)
  }

  if (updates.length === 0) return true

  params.push(id)
  db.run(`UPDATE entity_log SET ${updates.join(', ')} WHERE id = ?`, params)
  saveDatabase()

  return true
}

// Delete an entity log entry
export function deleteById(id: number): boolean {
  const db = getDb()

  const existing = findById(id)
  if (!existing) return false

  db.run('DELETE FROM entity_log WHERE id = ?', [id])
  saveDatabase()

  return true
}

// Check if user owns entity log
export function isOwnedByUser(entityLogId: number, userId: number): boolean {
  const db = getDb()
  const stmt = db.prepare('SELECT 1 FROM entity_log WHERE id = ? AND user_id = ?')
  stmt.bind([entityLogId, userId])

  const exists = stmt.step()
  stmt.free()

  return exists
}

// Bulk upsert entities (for saving multiple entities at once)
export function bulkUpsert(userId: number, entities: Array<{ normalizedText: string; label: string; originalText: string }>): EntityLog[] {
  const results: EntityLog[] = []

  for (const entity of entities) {
    const result = upsert({
      userId,
      normalizedText: entity.normalizedText,
      label: entity.label,
      originalText: entity.originalText,
      isActive: true
    })
    results.push(result)
  }

  return results
}

// Set is_active to false for an entity (de-anonymize)
export function deactivate(userId: number, normalizedText: string): boolean {
  const existing = findByNormalizedText(userId, normalizedText)
  if (!existing) return false

  return update(existing.id, { isActive: false })
}

// Set is_active to true for an entity (re-anonymize)
export function activate(userId: number, normalizedText: string): boolean {
  const existing = findByNormalizedText(userId, normalizedText)
  if (!existing) return false

  return update(existing.id, { isActive: true })
}
