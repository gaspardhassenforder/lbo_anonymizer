import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom'
import App from './app/App'
import OCRView from './app/OCRView'
import LoginPage from './app/LoginPage'
import DocumentListPage from './app/DocumentListPage'
import ProtectedRoute from './app/ProtectedRoute'
import './i18n'
import './index.css'

const router = createBrowserRouter([
  // Public route - login page
  {
    path: '/login',
    element: <LoginPage />,
  },
  // Root path redirects to documents
  {
    path: '/',
    element: <Navigate to="/documents" replace />,
  },
  // Protected routes
  {
    path: '/editor',
    element: (
      <ProtectedRoute>
        <App />
      </ProtectedRoute>
    ),
  },
  {
    path: '/ocr',
    element: (
      <ProtectedRoute>
        <OCRView />
      </ProtectedRoute>
    ),
  },
  {
    path: '/documents',
    element: (
      <ProtectedRoute>
        <DocumentListPage />
      </ProtectedRoute>
    ),
  },
  // Catch-all route - redirect undefined paths to login
  {
    path: '*',
    element: <Navigate to="/login" replace />,
  },
])

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
)
