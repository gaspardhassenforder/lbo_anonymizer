import { Request, Response } from 'express'
import { findByUsername, verifyPassword } from '../repositories/userRepository.js'
import { generateToken, AuthenticatedRequest } from '../middleware/authMiddleware.js'

// POST /api/auth/login
export async function login(req: Request, res: Response): Promise<void> {
  try {
    const { username, password } = req.body

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' })
      return
    }

    const user = findByUsername(username)

    if (!user) {
      res.status(401).json({ error: 'Invalid username or password' })
      return
    }

    const isValid = await verifyPassword(user, password)

    if (!isValid) {
      res.status(401).json({ error: 'Invalid username or password' })
      return
    }

    const token = generateToken(user.id, user.username)

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username
      },
      token
    })
  } catch (error) {
    console.error('[AuthController] Login error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}

// POST /api/auth/logout
export function logout(_req: Request, res: Response): void {
  // With JWT, logout is handled client-side by discarding the token
  // This endpoint exists for API consistency and future session management
  res.json({ success: true })
}

// GET /api/auth/me
export function getCurrentUser(req: AuthenticatedRequest, res: Response): void {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated' })
    return
  }

  res.json({
    id: req.user.id,
    username: req.user.username
  })
}
