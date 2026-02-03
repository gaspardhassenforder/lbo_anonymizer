import { Router } from 'express'
import multer from 'multer'
import {
  listDocuments,
  uploadDocument,
  getDocument,
  getDocumentFull,
  downloadPdf,
  deleteDocument,
  renameDocument
} from '../controllers/documentsController.js'
import { authenticateToken } from '../middleware/authMiddleware.js'

const router = Router()

// Configure multer for file uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true)
    } else {
      cb(new Error('Only PDF files are allowed'))
    }
  }
})

// All routes require authentication
router.use(authenticateToken)

// GET /api/documents - List user's documents
router.get('/', listDocuments)

// POST /api/documents - Upload a new document
router.post('/', upload.single('pdf'), uploadDocument)

// GET /api/documents/:id - Get document details
router.get('/:id', getDocument)

// GET /api/documents/:id/full - Get document with entities for viewing
router.get('/:id/full', getDocumentFull)

// GET /api/documents/:id/pdf - Download PDF
router.get('/:id/pdf', downloadPdf)

// DELETE /api/documents/:id - Delete document
router.delete('/:id', deleteDocument)

// PATCH /api/documents/:id - Rename document
router.patch('/:id', renameDocument)

export default router
