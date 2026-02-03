import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { findById, UserWithoutPassword } from '../repositories/userRepository.js'

// JWT Secret - in production, use environment variable
const JWT_SECRET = process.env.JWT_SECRET || 'lbo-anonymizer-secret-key-change-in-production'

export interface JwtPayload {
  userId: number
  username: string
}

export interface AuthenticatedRequest extends Request {
  user?: UserWithoutPassword
}

// Middleware to verify JWT token
export function authenticateToken(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization
  const token = authHeader && authHeader.split(' ')[1] // Bearer TOKEN

  if (!token) {
    res.status(401).json({ error: 'Access token required' })
    return
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload
    const user = findById(payload.userId)

    if (!user) {
      res.status(401).json({ error: 'User not found' })
      return
    }

    req.user = user
    next()
  } catch (error) {
    res.status(403).json({ error: 'Invalid or expired token' })
  }
}

// Generate JWT token
export function generateToken(userId: number, username: string): string {
  return jwt.sign(
    { userId, username } as JwtPayload,
    JWT_SECRET,
    { expiresIn: '24h' }
  )
}

export { JWT_SECRET }
