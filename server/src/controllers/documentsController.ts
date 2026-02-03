import { Response } from 'express'
import { AuthenticatedRequest } from '../middleware/authMiddleware.js'
import * as documentRepo from '../repositories/documentRepository.js'

// GET /api/documents
export function listDocuments(req: AuthenticatedRequest, res: Response): void {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated' })
    return
  }

  try {
    const documents = documentRepo.findByUserId(req.user.id)

    // Transform to API format
    const response = documents.map(doc => ({
      id: doc.id,
      filename: doc.filename,
      originalFilename: doc.original_filename,
      pageCount: doc.page_count,
      entityCount: doc.entity_count,
      createdAt: doc.created_at
    }))

    res.json(response)
  } catch (error) {
    console.error('[DocumentsController] List error:', error)
    res.status(500).json({ error: 'Failed to fetch documents' })
  }
}

// POST /api/documents
export function uploadDocument(req: AuthenticatedRequest, res: Response): void {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated' })
    return
  }

  try {
    const file = req.file
    const { originalFilename, entitiesJson, pagesJson, pageCount, entityCount } = req.body

    if (!file) {
      res.status(400).json({ error: 'PDF file is required' })
      return
    }

    if (!originalFilename || !entitiesJson) {
      res.status(400).json({ error: 'Missing required fields' })
      return
    }

    const document = documentRepo.create({
      userId: req.user.id,
      filename: file.filename || `document-${Date.now()}.pdf`,
      originalFilename,
      pdfBytes: file.buffer,
      entitiesJson,
      pagesJson: pagesJson || '[]',
      pageCount: parseInt(pageCount) || 0,
      entityCount: parseInt(entityCount) || 0
    })

    res.status(201).json({
      id: document.id,
      filename: document.filename,
      originalFilename: document.original_filename,
      pageCount: document.page_count,
      entityCount: document.entity_count,
      createdAt: document.created_at
    })
  } catch (error) {
    console.error('[DocumentsController] Upload error:', error)
    res.status(500).json({ error: 'Failed to upload document' })
  }
}

// GET /api/documents/:id
export function getDocument(req: AuthenticatedRequest, res: Response): void {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated' })
    return
  }

  try {
    const documentId = parseInt(req.params.id)

    if (isNaN(documentId)) {
      res.status(400).json({ error: 'Invalid document ID' })
      return
    }

    // Check ownership
    if (!documentRepo.isOwnedByUser(documentId, req.user.id)) {
      res.status(404).json({ error: 'Document not found' })
      return
    }

    const doc = documentRepo.findMetadataById(documentId)

    if (!doc) {
      res.status(404).json({ error: 'Document not found' })
      return
    }

    res.json({
      id: doc.id,
      filename: doc.filename,
      originalFilename: doc.original_filename,
      pageCount: doc.page_count,
      entityCount: doc.entity_count,
      createdAt: doc.created_at
    })
  } catch (error) {
    console.error('[DocumentsController] Get error:', error)
    res.status(500).json({ error: 'Failed to fetch document' })
  }
}

// GET /api/documents/:id/full - Get document with entities for viewing
export function getDocumentFull(req: AuthenticatedRequest, res: Response): void {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated' })
    return
  }

  try {
    const documentId = parseInt(req.params.id)

    if (isNaN(documentId)) {
      res.status(400).json({ error: 'Invalid document ID' })
      return
    }

    // Check ownership
    if (!documentRepo.isOwnedByUser(documentId, req.user.id)) {
      res.status(404).json({ error: 'Document not found' })
      return
    }

    const doc = documentRepo.findById(documentId)

    if (!doc) {
      res.status(404).json({ error: 'Document not found' })
      return
    }

    res.json({
      id: doc.id,
      filename: doc.filename,
      originalFilename: doc.original_filename,
      pageCount: doc.page_count,
      entityCount: doc.entity_count,
      createdAt: doc.created_at,
      entitiesJson: doc.entities_json,
      pagesJson: doc.pages_json || '[]'
    })
  } catch (error) {
    console.error('[DocumentsController] Get full error:', error)
    res.status(500).json({ error: 'Failed to fetch document' })
  }
}

// GET /api/documents/:id/pdf
export function downloadPdf(req: AuthenticatedRequest, res: Response): void {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated' })
    return
  }

  try {
    const documentId = parseInt(req.params.id)

    if (isNaN(documentId)) {
      res.status(400).json({ error: 'Invalid document ID' })
      return
    }

    // Check ownership
    if (!documentRepo.isOwnedByUser(documentId, req.user.id)) {
      res.status(404).json({ error: 'Document not found' })
      return
    }

    const doc = documentRepo.findById(documentId)

    if (!doc) {
      res.status(404).json({ error: 'Document not found' })
      return
    }

    // Convert Uint8Array to Buffer for proper Express handling
    const pdfBuffer = Buffer.from(doc.pdf_bytes)
    console.log(`[DocumentsController] Sending PDF: ${doc.original_filename}, size: ${pdfBuffer.length} bytes`)

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${doc.original_filename}"`)
    res.setHeader('Content-Length', pdfBuffer.length.toString())
    res.send(pdfBuffer)
  } catch (error) {
    console.error('[DocumentsController] Download error:', error)
    res.status(500).json({ error: 'Failed to download document' })
  }
}

// DELETE /api/documents/:id
export function deleteDocument(req: AuthenticatedRequest, res: Response): void {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated' })
    return
  }

  try {
    const documentId = parseInt(req.params.id)

    if (isNaN(documentId)) {
      res.status(400).json({ error: 'Invalid document ID' })
      return
    }

    // Check ownership
    if (!documentRepo.isOwnedByUser(documentId, req.user.id)) {
      res.status(404).json({ error: 'Document not found' })
      return
    }

    const deleted = documentRepo.deleteById(documentId)

    if (!deleted) {
      res.status(404).json({ error: 'Document not found' })
      return
    }

    res.json({ success: true })
  } catch (error) {
    console.error('[DocumentsController] Delete error:', error)
    res.status(500).json({ error: 'Failed to delete document' })
  }
}

// PATCH /api/documents/:id
export function renameDocument(req: AuthenticatedRequest, res: Response): void {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated' })
    return
  }

  try {
    const documentId = parseInt(req.params.id)
    const { filename } = req.body

    if (isNaN(documentId)) {
      res.status(400).json({ error: 'Invalid document ID' })
      return
    }

    if (!filename || typeof filename !== 'string' || filename.trim().length === 0) {
      res.status(400).json({ error: 'Filename is required' })
      return
    }

    // Check ownership
    if (!documentRepo.isOwnedByUser(documentId, req.user.id)) {
      res.status(404).json({ error: 'Document not found' })
      return
    }

    const updated = documentRepo.updateFilename(documentId, filename.trim())

    if (!updated) {
      res.status(404).json({ error: 'Document not found' })
      return
    }

    // Return updated document metadata
    const doc = documentRepo.findMetadataById(documentId)
    if (!doc) {
      res.status(404).json({ error: 'Document not found' })
      return
    }

    res.json({
      id: doc.id,
      filename: doc.filename,
      originalFilename: doc.original_filename,
      pageCount: doc.page_count,
      entityCount: doc.entity_count,
      createdAt: doc.created_at
    })
  } catch (error) {
    console.error('[DocumentsController] Rename error:', error)
    res.status(500).json({ error: 'Failed to rename document' })
  }
}
