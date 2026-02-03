import { Router } from 'express'
import { login, logout, getCurrentUser } from '../controllers/authController.js'
import { authenticateToken } from '../middleware/authMiddleware.js'

const router = Router()

// POST /api/auth/login - Public
router.post('/login', login)

// POST /api/auth/logout - Public (for consistency, actual logout is client-side)
router.post('/logout', logout)

// GET /api/auth/me - Protected
router.get('/me', authenticateToken, getCurrentUser)

export default router
