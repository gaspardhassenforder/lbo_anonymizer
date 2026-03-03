import { get, set, del, keys } from 'idb-keyval'
import type { EntityLabel } from '../types'

const DOC_META_KEY = 'lbo-anonymizer-documents-meta-v1'
const CORPUS_RULES_KEY = 'lbo-anonymizer-corpus-rules-v1'
const DOC_DATA_PREFIX = 'lbo-anonymizer-doc-data:'

export interface DocumentMeta {
  id: string
  /** Display name (renameable) */
  filename: string
  /** Original uploaded filename (never changes) */
  originalFilename: string
  pageCount: number
  entityCount: number
  createdAt: string
  updatedAt: string
  isDraft?: boolean
}

export interface DocumentData {
  pdfData: ArrayBuffer
  pagesJson: string
  entitiesJson: string
  regionsJson?: string
}

export interface CorpusRules {
  suppressedTexts: string[]
  labelOverrides: Array<[string, EntityLabel]>
  forcedLabels: Array<[string, EntityLabel]>
}

function docDataKey(id: string): string {
  return `${DOC_DATA_PREFIX}${id}`
}

export async function loadAllDocumentMetas(): Promise<DocumentMeta[]> {
  const metas = await get<DocumentMeta[] | undefined>(DOC_META_KEY)
  return Array.isArray(metas) ? metas : []
}

export async function saveAllDocumentMetas(metas: DocumentMeta[]): Promise<void> {
  await set(DOC_META_KEY, metas)
}

export async function upsertDocumentMeta(meta: DocumentMeta): Promise<void> {
  const metas = await loadAllDocumentMetas()
  const idx = metas.findIndex((m) => m.id === meta.id)
  if (idx === -1) {
    metas.push(meta)
  } else {
    metas[idx] = meta
  }
  // Most recent first
  metas.sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt))
  await saveAllDocumentMetas(metas)
}

export async function deleteDocumentMeta(id: string): Promise<void> {
  const metas = await loadAllDocumentMetas()
  await saveAllDocumentMetas(metas.filter((m) => m.id !== id))
}

export async function renameDocumentMeta(id: string, newFilename: string): Promise<void> {
  const metas = await loadAllDocumentMetas()
  const idx = metas.findIndex((m) => m.id === id)
  if (idx === -1) return
  metas[idx] = { ...metas[idx], filename: newFilename, updatedAt: new Date().toISOString() }
  await saveAllDocumentMetas(metas)
}

export async function putDocumentData(id: string, data: DocumentData): Promise<void> {
  await set(docDataKey(id), data)
}

export async function getDocumentData(id: string): Promise<DocumentData | null> {
  const data = await get<DocumentData | undefined>(docDataKey(id))
  return data ?? null
}

export async function deleteDocumentData(id: string): Promise<void> {
  await del(docDataKey(id))
}

export async function loadCorpusRules(): Promise<CorpusRules> {
  const stored = await get<CorpusRules | undefined>(CORPUS_RULES_KEY)
  return stored ?? { suppressedTexts: [], labelOverrides: [], forcedLabels: [] }
}

export async function saveCorpusRules(rules: CorpusRules): Promise<void> {
  await set(CORPUS_RULES_KEY, rules)
}

/**
 * Wipe all locally persisted documents + rules from IndexedDB.
 */
export async function wipeAllLocalData(): Promise<void> {
  // Delete document meta list + corpus rules first
  await del(DOC_META_KEY)
  await del(CORPUS_RULES_KEY)

  // Delete all per-document data keys
  const allKeys = await keys()
  const toDelete = allKeys
    .filter((k) => typeof k === 'string' && (k as string).startsWith(DOC_DATA_PREFIX))
    .map((k) => k as string)
  for (const k of toDelete) {
    await del(k)
  }

  // Also clear any legacy single-PDF persistence
  await cleanupLegacyPersistence()

  // Reset editor UI preferences so help popup and hints show again after next login
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('lbo-anonymizer-editor-help-dismissed')
    localStorage.removeItem('lbo-anonymizer-select-hint-dismissed')
  }
}

/**
 * Best-effort wipe for previous single-PDF persistence keys and any lingering doc-data keys.
 * Intended for migrations/dev cleanup; safe to call.
 */
export async function cleanupLegacyPersistence(): Promise<void> {
  try {
    // old keys from pdfPersistence.ts
    await del('lbo-anonymizer-pdf')
    await del('lbo-anonymizer-filename')
  } catch {
    // ignore
  }

  try {
    const allKeys = await keys()
    const toDelete = allKeys
      .filter((k) => typeof k === 'string' && (k as string).startsWith(DOC_DATA_PREFIX))
      .map((k) => k as string)
    for (const k of toDelete) {
      await del(k)
    }
  } catch {
    // ignore
  }
}

