import { getDb, saveDatabase } from '../config/database.js'

export interface Document {
  id: number
  user_id: number
  filename: string
  original_filename: string
  pdf_bytes: Uint8Array
  entities_json: string
  pages_json: string
  page_count: number
  entity_count: number
  created_at: string
}

export interface DocumentMetadata {
  id: number
  user_id: number
  filename: string
  original_filename: string
  page_count: number
  entity_count: number
  created_at: string
}

export interface CreateDocumentInput {
  userId: number
  filename: string
  originalFilename: string
  pdfBytes: Buffer
  entitiesJson: string
  pagesJson: string
  pageCount: number
  entityCount: number
}

// Get all documents for a user (without PDF bytes for efficiency)
export function findByUserId(userId: number): DocumentMetadata[] {
  const db = getDb()
  const stmt = db.prepare(`
    SELECT id, user_id, filename, original_filename, page_count, entity_count, created_at
    FROM documents
    WHERE user_id = ?
    ORDER BY created_at DESC
  `)
  stmt.bind([userId])

  const results: DocumentMetadata[] = []
  while (stmt.step()) {
    results.push(stmt.getAsObject() as DocumentMetadata)
  }
  stmt.free()

  return results
}

// Get a specific document by ID
export function findById(id: number): Document | undefined {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM documents WHERE id = ?')
  stmt.bind([id])

  if (stmt.step()) {
    const row = stmt.getAsObject() as Document
    stmt.free()

    // Debug: log PDF bytes info
    if (row.pdf_bytes) {
      const pdfBytes = row.pdf_bytes
      console.log(`[DocumentRepo] Retrieved PDF id=${id}, type=${typeof pdfBytes}, isUint8Array=${pdfBytes instanceof Uint8Array}, length=${pdfBytes.length || 'N/A'}, first bytes: ${pdfBytes.slice ? Array.from(pdfBytes.slice(0, 10)).join(',') : 'N/A'}`)
    }

    return row
  }

  stmt.free()
  return undefined
}

// Get document metadata by ID (without PDF bytes)
export function findMetadataById(id: number): DocumentMetadata | undefined {
  const db = getDb()
  const stmt = db.prepare(`
    SELECT id, user_id, filename, original_filename, page_count, entity_count, created_at
    FROM documents
    WHERE id = ?
  `)
  stmt.bind([id])

  if (stmt.step()) {
    const row = stmt.getAsObject() as DocumentMetadata
    stmt.free()
    return row
  }

  stmt.free()
  return undefined
}

// Get document PDF bytes only
export function getPdfBytes(id: number): Uint8Array | undefined {
  const db = getDb()
  const stmt = db.prepare('SELECT pdf_bytes FROM documents WHERE id = ?')
  stmt.bind([id])

  if (stmt.step()) {
    const row = stmt.getAsObject() as { pdf_bytes: Uint8Array }
    stmt.free()
    return row.pdf_bytes
  }

  stmt.free()
  return undefined
}

// Create a new document
export function create(input: CreateDocumentInput): DocumentMetadata {
  const db = getDb()

  // Ensure pdfBytes is a Uint8Array for sql.js
  const pdfData = input.pdfBytes instanceof Uint8Array
    ? input.pdfBytes
    : new Uint8Array(input.pdfBytes)

  console.log(`[DocumentRepo] Storing PDF: ${input.originalFilename}, size: ${pdfData.length} bytes, first bytes: ${Array.from(pdfData.slice(0, 10)).join(',')}`)

  db.run(`
    INSERT INTO documents (user_id, filename, original_filename, pdf_bytes, entities_json, pages_json, page_count, entity_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    input.userId,
    input.filename,
    input.originalFilename,
    pdfData,
    input.entitiesJson,
    input.pagesJson,
    input.pageCount,
    input.entityCount
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
    filename: input.filename,
    original_filename: input.originalFilename,
    page_count: input.pageCount,
    entity_count: input.entityCount,
    created_at: new Date().toISOString()
  }
}

// Delete a document
export function deleteById(id: number): boolean {
  const db = getDb()

  // Check if document exists first
  const exists = findMetadataById(id)
  if (!exists) return false

  db.run('DELETE FROM documents WHERE id = ?', [id])
  saveDatabase()

  return true
}

// Check if user owns document
export function isOwnedByUser(documentId: number, userId: number): boolean {
  const db = getDb()
  const stmt = db.prepare('SELECT 1 FROM documents WHERE id = ? AND user_id = ?')
  stmt.bind([documentId, userId])

  const exists = stmt.step()
  stmt.free()

  return exists
}

// Update document filename
export function updateFilename(id: number, newFilename: string): boolean {
  const db = getDb()

  // Check if document exists first
  const exists = findMetadataById(id)
  if (!exists) return false

  db.run('UPDATE documents SET original_filename = ? WHERE id = ?', [newFilename, id])
  saveDatabase()

  return true
}

// Normalize text for consistent matching (same as client-side)
function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

// Types for entity JSON
interface EntityJson {
  id: string
  text: string
  label: string
  pageIndex: number
  charStart: number
  charEnd: number
  confidence: number
  tokens?: unknown[]
}

/**
 * Apply an entity change (label update or removal) to all documents for a user.
 * This is used when the user selects "all documents" scope for label changes or removals.
 *
 * @param userId - The user ID
 * @param normalizedText - The normalized text of the entity to update
 * @param action - Either 'update_label' or 'remove'
 * @param newLabel - The new label (required for 'update_label' action)
 * @returns Object with count of updated documents
 */
export function applyEntityChangeToAllDocuments(
  userId: number,
  normalizedText: string,
  action: 'update_label' | 'remove',
  newLabel?: string
): { updatedCount: number } {
  const db = getDb()

  // Get all documents for this user
  const documents = findByUserId(userId)
  let updatedCount = 0

  for (const doc of documents) {
    // Get full document to access entities_json
    const fullDoc = findById(doc.id)
    if (!fullDoc || !fullDoc.entities_json) continue

    try {
      const entities: EntityJson[] = JSON.parse(fullDoc.entities_json)
      let modified = false
      let newEntities: EntityJson[]

      if (action === 'remove') {
        // Filter out entities with matching normalized text
        newEntities = entities.filter(entity => {
          const entityNormalized = normalizeText(entity.text)
          if (entityNormalized === normalizedText) {
            modified = true
            return false
          }
          return true
        })
      } else {
        // Update label for entities with matching normalized text
        newEntities = entities.map(entity => {
          const entityNormalized = normalizeText(entity.text)
          if (entityNormalized === normalizedText && newLabel && entity.label !== newLabel) {
            modified = true
            return { ...entity, label: newLabel }
          }
          return entity
        })
      }

      if (modified) {
        // Update the document's entities_json
        const newEntitiesJson = JSON.stringify(newEntities)
        db.run(
          'UPDATE documents SET entities_json = ?, entity_count = ? WHERE id = ?',
          [newEntitiesJson, newEntities.length, doc.id]
        )
        updatedCount++
      }
    } catch (error) {
      console.error(`[DocumentRepo] Failed to update entities for document ${doc.id}:`, error)
    }
  }

  if (updatedCount > 0) {
    saveDatabase()
  }

  console.log(`[DocumentRepo] Applied entity change to ${updatedCount} documents for user ${userId}`)
  return { updatedCount }
}
