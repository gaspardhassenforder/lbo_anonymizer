# LBO Anonymizer

A privacy-first document anonymization tool that automatically detects and redacts sensitive information in PDF documents. Built with React and powered by local AI models for complete data privacy.

**100% local processing** - your documents are analyzed entirely in your browser. Sensitive data never leaves your machine during processing.

## Features

### Core Functionality
- **AI-Powered Detection**: Uses GLiNER and CamemBERT NER models for intelligent entity recognition
- **OCR Support**: Tesseract.js integration for scanned document processing
- **Multiple Entity Types**: Detects 13+ entity types (persons, organizations, addresses, financial data, etc.)
- **Interactive Editing**: Review, modify, add, or remove detected entities before export
- **Tag Mapping**: Consistent anonymization tags across documents (e.g., `[PERSON_1]`, `[ORGANIZATION_2]`)
- **Undo/Redo**: Full edit history with Ctrl+Z/Y support

### New Features
- **User Authentication**: Secure login system with JWT tokens
- **Document Persistence**: PDFs survive page refresh via IndexedDB
- **Document Management**: Save, list, download, and delete anonymized documents on server
- **Progressive Processing**: View and edit the first page while remaining pages process in background
- **Multi-language UI**: English and French interface support
- **Offline Support**: Works without backend, falls back to local-only mode

## Screenshots

```
┌─────────────────────────────────────────────────────────────┐
│  Login Page          │  Document Editor    │  Document List │
│  ┌─────────────┐     │  ┌────────────────┐ │  ┌──────────┐  │
│  │ Username    │     │  │ PDF Viewer     │ │  │ Doc 1    │  │
│  │ Password    │     │  │ + Highlights   │ │  │ Doc 2    │  │
│  │ [Sign In]   │     │  │                │ │  │ Doc 3    │  │
│  └─────────────┘     │  └────────────────┘ │  └──────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Entity Types Detected

| Entity | Detection Method | Example |
|--------|-----------------|---------|
| `PERSON` | NER Model | John Smith, Marie Dupont |
| `ORGANIZATION` | NER Model | Acme Corp, SARL Example |
| `ADDRESS` | NER Model + Regex | 123 Main St, Paris 75001 |
| `EMAIL` | Regex | john@example.com |
| `PHONE` | Regex | +33 1 23 45 67 89 |
| `SSN` | Regex | 1 85 12 75 108 123 45 |
| `IBAN` | Regex | FR76 1234 5678 9012 |
| `BANK_ACCOUNT` | Regex | 12345678901 |
| `CREDIT_CARD` | Regex + Luhn | 4111 1111 1111 1111 |
| `DATE` | Regex | 15/03/2024 |
| `SIREN` | Regex + Luhn | 123 456 789 |
| `SIRET` | Regex + Luhn | 123 456 789 00012 |
| `CAPITAL` | Regex | 10 000 EUR |

## Architecture

```
lbo-anonymizer/
├── src/                    # Frontend React application
│   ├── api/                # API client and endpoint wrappers
│   │   ├── client.ts       # Fetch wrapper with auth
│   │   ├── authApi.ts      # Authentication endpoints
│   │   └── documentsApi.ts # Document CRUD endpoints
│   ├── app/                # Main application components
│   │   ├── App.tsx         # Main editor view
│   │   ├── LoginPage.tsx   # Authentication page
│   │   ├── DocumentListPage.tsx  # Document management
│   │   ├── ProtectedRoute.tsx    # Auth guard
│   │   └── OCRView.tsx     # Debug OCR viewer
│   ├── components/         # Reusable UI components
│   │   ├── Toolbar.tsx     # Action toolbar
│   │   ├── Sidebar.tsx     # Entity list sidebar
│   │   ├── DropZone.tsx    # File upload zone
│   │   ├── DocumentCard.tsx # Document list card
│   │   └── ...
│   ├── export/             # PDF and JSON export
│   ├── hooks/              # Custom React hooks
│   ├── locales/            # i18n translation files (en, fr)
│   ├── ner/                # Named Entity Recognition
│   │   ├── gliner.ts       # GLiNER model wrapper
│   │   ├── camembert.ts    # CamemBERT model wrapper
│   │   ├── patterns.ts     # Regex pattern detectors
│   │   └── ner.worker.ts   # Web worker for NER
│   ├── ocr/                # OCR processing (Tesseract.js)
│   ├── pdf/                # PDF loading and rendering
│   ├── processing/         # Document processing pipeline
│   ├── services/           # Business logic services
│   ├── state/              # Zustand state management
│   │   ├── store.ts        # Main store with auth
│   │   └── pdfPersistence.ts # IndexedDB utilities
│   ├── tagging/            # Entity tagging and normalization
│   └── types/              # TypeScript type definitions
│
└── server/                 # Backend Express application
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── index.ts        # Express entry point
        ├── config/
        │   └── database.ts # SQLite (sql.js) setup
        ├── controllers/
        │   ├── authController.ts
        │   └── documentsController.ts
        ├── middleware/
        │   └── authMiddleware.ts  # JWT validation
        ├── migrations/
        │   └── 001_initial_schema.sql
        ├── repositories/
        │   ├── userRepository.ts
        │   └── documentRepository.ts
        └── routes/
            ├── auth.ts
            └── documents.ts
```

## Tech Stack

### Frontend
| Technology | Purpose |
|------------|---------|
| React 18 | UI framework |
| TypeScript | Type safety |
| Vite | Build tool |
| Zustand | State management |
| Zundo | Undo/redo middleware |
| React Router v7 | Client-side routing |
| Tailwind CSS | Styling |
| i18next | Internationalization |
| PDF.js | PDF rendering |
| pdf-lib | PDF generation |
| Tesseract.js | OCR engine |
| HuggingFace Transformers | NER models |
| GLiNER | Entity extraction |
| idb-keyval | IndexedDB storage |

### Backend
| Technology | Purpose |
|------------|---------|
| Express | Web framework |
| sql.js | SQLite (WebAssembly) |
| JWT | Authentication |
| bcryptjs | Password hashing |
| multer | File uploads |
| CORS | Cross-origin support |

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd lbo-anonymizer

# Install frontend dependencies
npm install

# Install backend dependencies
cd server
npm install
cd ..
```

### Running the Application

#### Development Mode

**Terminal 1 - Backend Server:**
```bash
cd server
npm run dev
# Server runs on http://localhost:3001
```

**Terminal 2 - Frontend:**
```bash
npm run dev
# App runs on http://localhost:5173
```

#### Production Build

```bash
# Build frontend
npm run build

# Build and start backend
cd server
npm run build
npm start
```

### Default Login Credentials

| Username | Password |
|----------|----------|
| admin    | admin    |

## Usage Guide

### 1. Authentication

Navigate to `http://localhost:5173`. You'll be redirected to the login page.

Enter your credentials and click "Sign In". The session persists until logout or token expiration (24 hours).

### 2. Upload a Document

- Drag and drop a PDF onto the upload zone, or click to browse
- Wait for AI models to load (first visit only, ~100-200MB cached)
- Document processes progressively - first page appears quickly

### 3. Review Detected Entities

- Detected entities are highlighted with color-coded backgrounds
- Use the sidebar to see all entities grouped by type
- Adjust the confidence threshold slider to filter uncertain detections

### 4. Edit Annotations

| Action | How To |
|--------|--------|
| Select entity | Click on highlighted text |
| Change label | Click entity → "Change label" → select new type |
| Remove single | Click entity → "Remove" |
| Remove all instances | Click entity → "Remove all" (for repeated text) |
| Add manual annotation | Select text → choose entity type |
| Apply to all | When changing/removing, option to apply to all matches |
| Undo/Redo | Ctrl+Z / Ctrl+Y or toolbar buttons |

### 5. Export Options

| Button | Action |
|--------|--------|
| **JSON** | Download entity data as JSON file |
| **Export PDF** | Download anonymized PDF with redactions |
| **Confirm** | Save to server and go to document list |

### 6. Document Management

From the Documents page (`/documents`):
- View all previously saved documents
- Download anonymized PDFs
- Delete documents
- Click "Load New Document" to process another file

## API Documentation

### Base URL
```
http://localhost:3001/api
```

### Authentication

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/auth/login` | POST | No | Login with credentials |
| `/auth/logout` | POST | No | Logout (client-side) |
| `/auth/me` | GET | Yes | Get current user info |

**Login Request:**
```json
POST /api/auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "admin"
}
```

**Login Response:**
```json
{
  "success": true,
  "user": { "id": 1, "username": "admin" },
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

### Documents

All document endpoints require `Authorization: Bearer <token>` header.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/documents` | GET | List user's documents |
| `/documents` | POST | Upload new document (multipart) |
| `/documents/:id` | GET | Get document details |
| `/documents/:id/pdf` | GET | Download PDF file |
| `/documents/:id` | DELETE | Delete document |

**Upload Request:**
```
POST /api/documents
Content-Type: multipart/form-data
Authorization: Bearer <token>

Fields:
- pdf: (file) PDF document
- originalFilename: (string) Original filename
- entitiesJson: (string) JSON array of entities
- pageCount: (number) Number of pages
- entityCount: (number) Number of entities
```

### Health Check

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Server status |

## Data Storage

### Frontend (Browser)

| Storage | Data | Lifetime |
|---------|------|----------|
| IndexedDB | PDF file bytes | Until new document or confirm |
| sessionStorage | Auth state, document state | Browser session |
| localStorage | Language preference | Persistent |

### Backend (Server)

| Table | Data |
|-------|------|
| `users` | id, username, password_hash, created_at |
| `documents` | id, user_id, filename, pdf_bytes, entities_json, page_count, entity_count, created_at |

Database file: `server/data/lbo.db`

## Environment Variables

### Frontend (`.env`)
```env
VITE_API_URL=http://localhost:3001/api
```

### Backend
```env
PORT=3001
JWT_SECRET=your-secret-key-change-in-production
```

## Configuration

### NER Model Selection

Set `NER_MODEL` to switch between models:
- `gliner` (default) - GLiNER entity extraction
- `camembert` - CamemBERT NER model

### Model Loading

AI models are downloaded on first visit and cached by the browser:

| Model | Size | Purpose |
|-------|------|---------|
| Tesseract (fra) | ~15MB | OCR for scanned documents |
| GLiNER | ~100MB | Named entity recognition |

## Offline Mode

The application works offline after initial model load:

- Authentication falls back to hardcoded credentials
- Documents are processed locally
- Cannot save to server (Confirm button still navigates but skips upload)
- On reconnection, restart to use server features

## Security Considerations

| Aspect | Implementation |
|--------|----------------|
| Data privacy | All analysis is client-side |
| Authentication | JWT with 24-hour expiration |
| Password storage | bcrypt with 10 salt rounds |
| CORS | Configured for localhost only |
| File uploads | PDF mime-type validation, 50MB limit |

**Production recommendations:**
- Use HTTPS
- Set strong JWT_SECRET via environment variable
- Configure proper CORS origins
- Consider rate limiting

## Known Limitations

- **Large PDFs**: Documents with 100+ pages may be slow to process
- **Complex layouts**: Multi-column layouts may have reading order issues
- **OCR accuracy**: Depends on scan quality
- **View documents**: Re-opening saved documents from server not yet implemented

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Models not loading | Clear browser cache, check console for errors |
| Login fails | Ensure backend is running on port 3001 |
| Upload fails | Check file size (<50MB), ensure it's a valid PDF |
| Entities not detected | Try lowering confidence threshold |

## Development

### Adding New Entity Types

1. Add type to `src/types/index.ts` in `EntityLabel` union
2. Add color in `ENTITY_COLORS` constant
3. Add translations in `src/locales/en.json` and `fr.json`
4. Add regex pattern in `src/ner/patterns.ts` (optional)

### Type Checking

```bash
npx tsc --noEmit
```

### Project Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start frontend dev server |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build |
| `cd server && npm run dev` | Start backend dev server |

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run type checks (`npx tsc --noEmit`)
5. Commit (`git commit -m 'Add amazing feature'`)
6. Push (`git push origin feature/amazing-feature`)
7. Open a Pull Request

## License

MIT

## Acknowledgments

- [GLiNER](https://github.com/urchade/GLiNER) - Named Entity Recognition
- [Tesseract.js](https://github.com/naptha/tesseract.js) - OCR engine
- [PDF.js](https://mozilla.github.io/pdf.js/) - PDF rendering
- [pdf-lib](https://pdf-lib.js.org/) - PDF manipulation
- [HuggingFace Transformers.js](https://huggingface.co/docs/transformers.js) - ML models in browser
