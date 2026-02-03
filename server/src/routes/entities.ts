import { Router } from 'express'
import {
  listEntities,
  listActiveEntities,
  createEntity,
  bulkCreateEntities,
  updateEntity,
  deleteEntity,
  deactivateEntity,
  activateEntity,
  propagateLabelChange
} from '../controllers/entityLogController.js'
import { authenticateToken } from '../middleware/authMiddleware.js'

const router = Router()

// All routes require authentication
router.use(authenticateToken)

// GET /api/entities - List user's entity log
router.get('/', listEntities)

// GET /api/entities/active - List active entities (for auto-applying)
router.get('/active', listActiveEntities)

// POST /api/entities - Add entity to log
router.post('/', createEntity)

// POST /api/entities/bulk - Add multiple entities to log
router.post('/bulk', bulkCreateEntities)

// POST /api/entities/deactivate - Deactivate entity by normalized text
router.post('/deactivate', deactivateEntity)

// POST /api/entities/activate - Activate entity by normalized text
router.post('/activate', activateEntity)

// POST /api/entities/propagate-label - Propagate label change to all stored documents
router.post('/propagate-label', propagateLabelChange)

// PUT /api/entities/:id - Update entity
router.put('/:id', updateEntity)

// DELETE /api/entities/:id - Delete entity
router.delete('/:id', deleteEntity)

export default router
