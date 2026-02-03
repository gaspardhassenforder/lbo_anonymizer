import { Response } from 'express'
import { AuthenticatedRequest } from '../middleware/authMiddleware.js'
import * as entityLogRepo from '../repositories/entityLogRepository.js'
import * as documentRepo from '../repositories/documentRepository.js'

// GET /api/entities - List user's entity log
export function listEntities(req: AuthenticatedRequest, res: Response): void {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated' })
    return
  }

  try {
    const entities = entityLogRepo.findByUserId(req.user.id)

    // Transform to API format
    const response = entities.map(entity => ({
      id: entity.id,
      normalizedText: entity.normalized_text,
      label: entity.label,
      originalText: entity.original_text,
      isActive: entity.is_active === 1,
      createdAt: entity.created_at
    }))

    res.json(response)
  } catch (error) {
    console.error('[EntityLogController] List error:', error)
    res.status(500).json({ error: 'Failed to fetch entity log' })
  }
}

// GET /api/entities/active - List active entities (for auto-applying)
export function listActiveEntities(req: AuthenticatedRequest, res: Response): void {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated' })
    return
  }

  try {
    const entities = entityLogRepo.findActiveByUserId(req.user.id)

    // Transform to API format
    const response = entities.map(entity => ({
      id: entity.id,
      normalizedText: entity.normalized_text,
      label: entity.label,
      originalText: entity.original_text,
      isActive: true,
      createdAt: entity.created_at
    }))

    res.json(response)
  } catch (error) {
    console.error('[EntityLogController] List active error:', error)
    res.status(500).json({ error: 'Failed to fetch active entities' })
  }
}

// POST /api/entities - Add entity to log (or update if exists)
export function createEntity(req: AuthenticatedRequest, res: Response): void {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated' })
    return
  }

  try {
    const { normalizedText, label, originalText, isActive } = req.body

    if (!normalizedText || !label || !originalText) {
      res.status(400).json({ error: 'Missing required fields: normalizedText, label, originalText' })
      return
    }

    const entity = entityLogRepo.upsert({
      userId: req.user.id,
      normalizedText,
      label,
      originalText,
      isActive: isActive !== false
    })

    res.status(201).json({
      id: entity.id,
      normalizedText: entity.normalized_text,
      label: entity.label,
      originalText: entity.original_text,
      isActive: entity.is_active === 1,
      createdAt: entity.created_at
    })
  } catch (error) {
    console.error('[EntityLogController] Create error:', error)
    res.status(500).json({ error: 'Failed to create entity log entry' })
  }
}

// POST /api/entities/bulk - Add multiple entities to log
export function bulkCreateEntities(req: AuthenticatedRequest, res: Response): void {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated' })
    return
  }

  try {
    const { entities } = req.body

    if (!Array.isArray(entities)) {
      res.status(400).json({ error: 'entities must be an array' })
      return
    }

    const results = entityLogRepo.bulkUpsert(
      req.user.id,
      entities.map(e => ({
        normalizedText: e.normalizedText,
        label: e.label,
        originalText: e.originalText
      }))
    )

    res.status(201).json(results.map(entity => ({
      id: entity.id,
      normalizedText: entity.normalized_text,
      label: entity.label,
      originalText: entity.original_text,
      isActive: entity.is_active === 1,
      createdAt: entity.created_at
    })))
  } catch (error) {
    console.error('[EntityLogController] Bulk create error:', error)
    res.status(500).json({ error: 'Failed to create entity log entries' })
  }
}

// PUT /api/entities/:id - Update entity (label, is_active)
export function updateEntity(req: AuthenticatedRequest, res: Response): void {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated' })
    return
  }

  try {
    const entityId = parseInt(req.params.id)
    const { label, isActive } = req.body

    if (isNaN(entityId)) {
      res.status(400).json({ error: 'Invalid entity ID' })
      return
    }

    // Check ownership
    if (!entityLogRepo.isOwnedByUser(entityId, req.user.id)) {
      res.status(404).json({ error: 'Entity not found' })
      return
    }

    const updated = entityLogRepo.update(entityId, { label, isActive })

    if (!updated) {
      res.status(404).json({ error: 'Entity not found' })
      return
    }

    const entity = entityLogRepo.findById(entityId)
    if (!entity) {
      res.status(404).json({ error: 'Entity not found' })
      return
    }

    res.json({
      id: entity.id,
      normalizedText: entity.normalized_text,
      label: entity.label,
      originalText: entity.original_text,
      isActive: entity.is_active === 1,
      createdAt: entity.created_at
    })
  } catch (error) {
    console.error('[EntityLogController] Update error:', error)
    res.status(500).json({ error: 'Failed to update entity' })
  }
}

// DELETE /api/entities/:id - Delete entity from log
export function deleteEntity(req: AuthenticatedRequest, res: Response): void {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated' })
    return
  }

  try {
    const entityId = parseInt(req.params.id)

    if (isNaN(entityId)) {
      res.status(400).json({ error: 'Invalid entity ID' })
      return
    }

    // Check ownership
    if (!entityLogRepo.isOwnedByUser(entityId, req.user.id)) {
      res.status(404).json({ error: 'Entity not found' })
      return
    }

    const deleted = entityLogRepo.deleteById(entityId)

    if (!deleted) {
      res.status(404).json({ error: 'Entity not found' })
      return
    }

    res.json({ success: true })
  } catch (error) {
    console.error('[EntityLogController] Delete error:', error)
    res.status(500).json({ error: 'Failed to delete entity' })
  }
}

// POST /api/entities/deactivate - Deactivate an entity by normalized text
export function deactivateEntity(req: AuthenticatedRequest, res: Response): void {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated' })
    return
  }

  try {
    const { normalizedText, propagateToDocuments } = req.body

    if (!normalizedText) {
      res.status(400).json({ error: 'normalizedText is required' })
      return
    }

    const success = entityLogRepo.deactivate(req.user.id, normalizedText)

    // If propagateToDocuments is true, also update all stored documents
    let updatedDocuments = 0
    if (propagateToDocuments) {
      const result = documentRepo.applyEntityChangeToAllDocuments(
        req.user.id,
        normalizedText,
        'remove'
      )
      updatedDocuments = result.updatedCount
    }

    if (!success) {
      // Entity doesn't exist in log, but we might have updated documents
      res.json({ success: true, existed: false, updatedDocuments })
      return
    }

    res.json({ success: true, existed: true, updatedDocuments })
  } catch (error) {
    console.error('[EntityLogController] Deactivate error:', error)
    res.status(500).json({ error: 'Failed to deactivate entity' })
  }
}

// POST /api/entities/activate - Activate an entity by normalized text
export function activateEntity(req: AuthenticatedRequest, res: Response): void {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated' })
    return
  }

  try {
    const { normalizedText } = req.body

    if (!normalizedText) {
      res.status(400).json({ error: 'normalizedText is required' })
      return
    }

    const success = entityLogRepo.activate(req.user.id, normalizedText)

    if (!success) {
      res.status(404).json({ error: 'Entity not found in log' })
      return
    }

    res.json({ success: true })
  } catch (error) {
    console.error('[EntityLogController] Activate error:', error)
    res.status(500).json({ error: 'Failed to activate entity' })
  }
}

// POST /api/entities/propagate-label - Propagate a label change to all stored documents
export function propagateLabelChange(req: AuthenticatedRequest, res: Response): void {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated' })
    return
  }

  try {
    const { normalizedText, newLabel, originalText } = req.body

    if (!normalizedText || !newLabel) {
      res.status(400).json({ error: 'normalizedText and newLabel are required' })
      return
    }

    // Update the entity log entry (or create if doesn't exist)
    entityLogRepo.upsert({
      userId: req.user.id,
      normalizedText,
      label: newLabel,
      originalText: originalText || normalizedText,
      isActive: true
    })

    // Propagate the label change to all stored documents
    const result = documentRepo.applyEntityChangeToAllDocuments(
      req.user.id,
      normalizedText,
      'update_label',
      newLabel
    )

    res.json({
      success: true,
      updatedDocuments: result.updatedCount
    })
  } catch (error) {
    console.error('[EntityLogController] Propagate label error:', error)
    res.status(500).json({ error: 'Failed to propagate label change' })
  }
}
