import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { initDatabase } from './config/database.js'
import { ensureAdminUser } from './repositories/userRepository.js'
import authRoutes from './routes/auth.js'
import documentsRoutes from './routes/documents.js'
import entitiesRoutes from './routes/entities.js'

const app = express()
const PORT = process.env.PORT || 3001

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"], // Required for Vite dev
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "http://localhost:*", "ws://localhost:*"],
      workerSrc: ["'self'", "blob:"],
    },
  },
  crossOriginEmbedderPolicy: false, // Required for PDF.js workers
}))

// Rate limiting for auth endpoints (prevent brute force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: { error: 'Too many login attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
})

// General API rate limiting
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: { error: 'Too many requests, please slow down' },
  standardHeaders: true,
  legacyHeaders: false,
})

// CORS
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000'], // Vite dev server
  credentials: true
}))

app.use(express.json())

// Apply rate limiting
app.use('/api/auth/login', authLimiter)
app.use('/api', apiLimiter)

// Routes
app.use('/api/auth', authRoutes)
app.use('/api/documents', documentsRoutes)
app.use('/api/entities', entitiesRoutes)

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Error handling middleware
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Server] Error:', err)
  res.status(500).json({ error: err.message || 'Internal server error' })
})

// Initialize and start server
async function start() {
  try {
    // Initialize database
    await initDatabase()

    // Ensure admin user exists with proper password hash
    await ensureAdminUser()

    app.listen(PORT, () => {
      console.log(`[Server] Running on http://localhost:${PORT}`)
      console.log('[Server] API endpoints:')
      console.log('  POST /api/auth/login')
      console.log('  POST /api/auth/logout')
      console.log('  GET  /api/auth/me')
      console.log('  GET  /api/documents')
      console.log('  POST /api/documents')
      console.log('  GET  /api/documents/:id')
      console.log('  GET  /api/documents/:id/full')
      console.log('  GET  /api/documents/:id/pdf')
      console.log('  PATCH /api/documents/:id')
      console.log('  DELETE /api/documents/:id')
      console.log('  GET  /api/entities')
      console.log('  GET  /api/entities/active')
      console.log('  POST /api/entities')
      console.log('  POST /api/entities/bulk')
      console.log('  PUT  /api/entities/:id')
      console.log('  DELETE /api/entities/:id')
    })
  } catch (error) {
    console.error('[Server] Failed to start:', error)
    process.exit(1)
  }
}

start()
