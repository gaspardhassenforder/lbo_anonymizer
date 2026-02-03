/**
 * Anonymization engine using CamemBERT-NER via Transformers.js
 * Combines ML-based entity detection with regex patterns for structured data
 * Integrates with EntityStore for centralized entity management
 */

import { PATTERNS } from './patterns.js';
import {
    loadModel as loadNERModel,
    isModelReady as isNERModelReady,
    detectEntitiesChunked,
    filterFalsePositives,
    expandToFullWord,
    setStatusCallback as setNERStatusCallback,
    getCurrentModel,
    isLoading as isNERLoading,
    ENTITY_TYPE_MAP
} from './ner-engine.js';

import * as EntityStore from './stores/entity-store.js';
import * as DocumentStore from './stores/document-store.js';

// Entity types (re-export from EntityStore for compatibility)
export const ENTITY_TYPES = EntityStore.ENTITY_TYPES;

// State
let isModelLoading = false;
let modelLoadPromise = null;

// Cached detection results (raw, before EntityStore)
let cachedMLEntities = [];
let cachedRegexEntities = [];

// Status callback
let statusCallback = null;

// Store original text for rebuild
let currentOriginalText = '';

/**
 * Set status callback for loading progress
 */
export function setStatusCallback(callback) {
    statusCallback = callback;
    setNERStatusCallback(callback);
}

function updateStatus(message, progress = null) {
    if (statusCallback) {
        statusCallback(message, progress);
    }
    console.log(message, progress !== null ? `${Math.round(progress * 100)}%` : '');
}

/**
 * Load the NER model (CamemBERT-NER via Transformers.js)
 */
export async function loadModel() {
    if (isNERModelReady()) return true;
    if (modelLoadPromise) return modelLoadPromise;

    isModelLoading = true;
    updateStatus('Chargement du modèle NER...', 0);

    modelLoadPromise = (async () => {
        try {
            await loadNERModel();
            isModelLoading = false;
            updateStatus('Modèle chargé avec succès!', 1);
            return true;
        } catch (error) {
            console.error('Error loading model:', error);
            isModelLoading = false;
            updateStatus('Erreur de chargement du modèle. Mode regex activé.', 0);
            throw error;
        }
    })();

    return modelLoadPromise;
}

/**
 * Check if model is ready
 */
export function isModelReady() {
    return isNERModelReady();
}

/**
 * Check if model is loading
 */
export function isLoading() {
    return isModelLoading || isNERLoading();
}

/**
 * Get current model info
 */
export function getModelInfo() {
    return getCurrentModel();
}

/**
 * Reset the anonymizer state
 */
export function reset() {
    cachedMLEntities = [];
    cachedRegexEntities = [];
}

/**
 * Full reset including EntityStore
 */
export function fullReset() {
    reset();
    EntityStore.reset();
}

/**
 * Add an entity to the ignore list
 */
export function ignoreEntity(original) {
    EntityStore.ignoreEntity(original);
}

/**
 * Clear the ignored entities list
 */
export function clearIgnoredEntities() {
    EntityStore.clearIgnored();
}

/**
 * Detect entities using regex patterns
 */
export function detectRegexEntities(text) {
    const entities = [];
    let match;

    // Phone numbers
    const phonePattern = new RegExp(PATTERNS.phone.source, 'g');
    while ((match = phonePattern.exec(text)) !== null) {
        entities.push({
            start: match.index,
            end: match.index + match[0].length,
            original: match[0],
            type: ENTITY_TYPES.TELEPHONE,
            confidence: 'high',
            source: 'regex'
        });
    }

    // Emails
    const emailPattern = new RegExp(PATTERNS.email.source, 'g');
    while ((match = emailPattern.exec(text)) !== null) {
        entities.push({
            start: match.index,
            end: match.index + match[0].length,
            original: match[0],
            type: ENTITY_TYPES.EMAIL,
            confidence: 'high',
            source: 'regex'
        });
    }

    // NIR (Social Security)
    const nirPattern = new RegExp(PATTERNS.nir.source, 'g');
    while ((match = nirPattern.exec(text)) !== null) {
        entities.push({
            start: match.index,
            end: match.index + match[0].length,
            original: match[0],
            type: ENTITY_TYPES.NIR,
            confidence: 'high',
            source: 'regex'
        });
    }

    // SIRET (14 digits) - check before SIREN
    const siretPattern = new RegExp(PATTERNS.siret.source, 'g');
    while ((match = siretPattern.exec(text)) !== null) {
        entities.push({
            start: match.index,
            end: match.index + match[0].length,
            original: match[0],
            type: ENTITY_TYPES.SIRET,
            confidence: 'high',
            source: 'regex'
        });
    }

    // SIREN (9 digits) - skip if overlaps with SIRET
    const sirenPattern = new RegExp(PATTERNS.siren.source, 'g');
    while ((match = sirenPattern.exec(text)) !== null) {
        const overlaps = entities.some(e =>
            (match.index >= e.start && match.index < e.end) ||
            (match.index + match[0].length > e.start && match.index + match[0].length <= e.end)
        );
        if (!overlaps) {
            entities.push({
                start: match.index,
                end: match.index + match[0].length,
                original: match[0],
                type: ENTITY_TYPES.SIREN,
                confidence: 'high',
                source: 'regex'
            });
        }
    }

    // Capital amounts
    const capitalPattern = new RegExp(PATTERNS.capital.source, 'gi');
    while ((match = capitalPattern.exec(text)) !== null) {
        if (match[1]) {
            const amountStart = match.index + match[0].indexOf(match[1]);
            const amountEnd = amountStart + match[1].length;
            entities.push({
                start: amountStart,
                end: amountEnd,
                original: match[1],
                type: ENTITY_TYPES.CAPITAL,
                confidence: 'high',
                source: 'regex'
            });
        }
    }

    // RCS
    const rcsPattern = new RegExp(PATTERNS.rcs.source, 'gi');
    while ((match = rcsPattern.exec(text)) !== null) {
        entities.push({
            start: match.index,
            end: match.index + match[0].length,
            original: match[0],
            type: ENTITY_TYPES.SIREN,
            confidence: 'high',
            source: 'regex'
        });
    }

    // French addresses
    const addressPattern = /\d{1,4}[\s,]+(?:rue|avenue|boulevard|place|chemin|allée|impasse|passage|cours|quai)\s+[A-Za-zÀ-ÿ\s\-']+,?\s*\d{5}\s+[A-Za-zÀ-ÿ\s\-]+/gi;
    while ((match = addressPattern.exec(text)) !== null) {
        entities.push({
            start: match.index,
            end: match.index + match[0].length,
            original: match[0].trim(),
            type: ENTITY_TYPES.ADRESSE,
            confidence: 'high',
            source: 'regex'
        });
    }

    // Simpler address pattern
    const simpleAddressPattern = /(?:au|demeurant\s+(?:au)?)\s+\d{1,4}[\s,]+(?:rue|avenue|boulevard|place|chemin|allée)[A-Za-zÀ-ÿ\s\-',]+(?:\d{5}\s+[A-Za-zÀ-ÿ\-]+)?/gi;
    while ((match = simpleAddressPattern.exec(text)) !== null) {
        const overlaps = entities.some(e =>
            (match.index >= e.start && match.index < e.end) ||
            (match.index + match[0].length > e.start && match.index + match[0].length <= e.end)
        );
        if (!overlaps) {
            entities.push({
                start: match.index,
                end: match.index + match[0].length,
                original: match[0].trim(),
                type: ENTITY_TYPES.ADRESSE,
                confidence: 'medium',
                source: 'regex'
            });
        }
    }

    return entities;
}

/**
 * Detect entities using the ML model (CamemBERT-NER)
 */
async function detectMLEntities(text) {
    console.log('[Anonymizer] detectMLEntities: ENTRY');
    console.log(`[Anonymizer] Model ready: ${isNERModelReady()}`);

    if (!isNERModelReady()) {
        console.warn('[Anonymizer] ML model not loaded, skipping ML detection');
        return [];
    }

    try {
        updateStatus('Détection ML en cours...', 0.2);

        // Use chunked detection for long documents
        console.log('[Anonymizer] Calling detectEntitiesChunked...');
        let entities = await detectEntitiesChunked(text, {
            threshold: 0.3,
            flatNer: true
        });

        console.log(`[Anonymizer] After detectEntitiesChunked: ${entities.length} entities`);

        // Filter false positives
        console.log('[Anonymizer] Calling filterFalsePositives...');
        const beforeFilter = entities.length;
        entities = filterFalsePositives(entities, text);
        console.log(`[Anonymizer] After filterFalsePositives: ${entities.length} entities (filtered ${beforeFilter - entities.length})`);

        // Expand to word boundaries and apply custom rules
        console.log('[Anonymizer] Expanding to word boundaries and applying AUTRE filter...');
        let autreFiltered = 0;
        entities = entities.map(entity => {
            // Phase 1, Step 1.4: Log AUTRE filtering
            if (entity.type === 'AUTRE') {
                console.log(`[Anonymizer] AUTRE FILTERED: "${entity.original}" (score=${entity.score?.toFixed(3)})`);
                autreFiltered++;
                return null;
            }

            // If positions are null/invalid, try to find the entity in the text
            let start = entity.start;
            let end = entity.end;
            if (start == null || end == null || start < 0 || end <= start) {
                const searchText = entity.original.toLowerCase();
                const textLower = text.toLowerCase();
                const foundIdx = textLower.indexOf(searchText);
                if (foundIdx >= 0) {
                    start = foundIdx;
                    end = foundIdx + entity.original.length;
                    console.log(`[Anonymizer] Found position for "${entity.original}": ${start}-${end}`);
                } else {
                    console.log(`[Anonymizer] Could not find "${entity.original}" in text, skipping`);
                    return null;
                }
            }

            // Expand to full word boundaries
            const expanded = expandToFullWord(text, start, end);
            const expandedText = text.slice(expanded.start, expanded.end);

            // Apply location expansion for numbers
            if (entity.type === 'LIEU') {
                const beforeText = text.slice(Math.max(0, expanded.start - 10), expanded.start);
                const numberMatch = beforeText.match(/(\d{2,5})\s*$/);
                if (numberMatch) {
                    const newStart = expanded.start - numberMatch[0].length;
                    return {
                        ...entity,
                        start: newStart,
                        end: expanded.end,
                        original: text.slice(newStart, expanded.end)
                    };
                }
            }

            return {
                ...entity,
                start: expanded.start,
                end: expanded.end,
                original: expandedText
            };
        }).filter(Boolean);

        console.log(`[Anonymizer] After AUTRE filter: ${entities.length} entities (${autreFiltered} AUTRE filtered)`);
        console.log(`[Anonymizer] ML entities final count: ${entities.length}`);
        entities.forEach(e => {
            console.log(`[Anonymizer]   - "${e.original}" (${e.type}) score=${e.score?.toFixed(3)}`);
        });

        return entities;

    } catch (error) {
        console.error('[Anonymizer] ML detection error:', error);
        return [];
    }
}

/**
 * Merge overlapping entities
 */
export function mergeEntities(entities, text) {
    console.log(`[Anonymizer] mergeEntities: ENTRY with ${entities.length} entities`);

    if (entities.length === 0) return [];

    // Sort by start position, then by confidence
    entities.sort((a, b) => {
        if (a.start !== b.start) return a.start - b.start;
        const confOrder = { high: 3, medium: 2, low: 1, manual: 4 };
        return (confOrder[b.confidence] || 0) - (confOrder[a.confidence] || 0);
    });

    console.log(`[Anonymizer] mergeEntities: sorted entities:`);
    entities.forEach(e => {
        console.log(`[Anonymizer]   "${e.original}" (${e.type}, ${e.source}) at ${e.start}-${e.end}`);
    });

    const merged = [];
    let current = { ...entities[0] };

    for (let i = 1; i < entities.length; i++) {
        const next = entities[i];

        if (next.start < current.end) {
            // Overlapping - keep higher priority
            const confOrder = { manual: 100, high: 3, medium: 2, low: 1 };
            const isRegexLocation = (e) => e.source === 'regex' && e.type === 'LIEU';

            const currentScore = (confOrder[current.confidence] || 0) * 1000 +
                               (current.score || 0.5) * 100 +
                               (current.end - current.start) +
                               (isRegexLocation(current) ? 500 : 0);
            const nextScore = (confOrder[next.confidence] || 0) * 1000 +
                            (next.score || 0.5) * 100 +
                            (next.end - next.start) +
                            (isRegexLocation(next) ? 500 : 0);

            if (nextScore > currentScore) {
                current = { ...next };
            }

            if (next.end > current.end && next.type === current.type) {
                current.end = next.end;
                current.original = text.slice(current.start, current.end);
            }
        } else {
            merged.push(current);
            current = { ...next };
        }
    }
    merged.push(current);

    console.log(`[Anonymizer] mergeEntities: EXIT with ${merged.length} merged entities`);
    return merged;
}

/**
 * Build anonymized result and populate EntityStore
 */
function buildAnonymizedResult(text) {
    console.log('[Anonymizer] buildAnonymizedResult: ENTRY');
    console.log(`[Anonymizer] Input text length: ${text?.length || 0}`);
    console.log(`[Anonymizer] DocumentStore.fullText length: ${DocumentStore.getFullText()?.length || 0}`);

    // Verify text consistency - positions from findTextOccurrences are relative to DocumentStore.fullText
    const docStoreText = DocumentStore.getFullText();
    if (text !== docStoreText) {
        console.warn('[Anonymizer] WARNING: Input text differs from DocumentStore.fullText!');
        console.warn(`[Anonymizer]   Input starts with: "${text?.substring(0, 50)}..."`);
        console.warn(`[Anonymizer]   DocStore starts with: "${docStoreText?.substring(0, 50)}..."`);
    }

    // Reset EntityStore
    EntityStore.reset();

    // Combine entities
    const allEntities = [...cachedRegexEntities, ...cachedMLEntities];
    console.log(`[Anonymizer] Building result: regex=${cachedRegexEntities.length}, ml=${cachedMLEntities.length}, combined=${allEntities.length}`);

    // Filter ignored
    const filteredEntities = allEntities.filter(e =>
        !EntityStore.isIgnored(e.original)
    );

    // Merge overlapping
    const mergedEntities = mergeEntities(filteredEntities, text);

    // Add to EntityStore (this will generate replacement tokens and find all occurrences)
    const addedEntities = [];
    const seenOriginals = new Set();

    for (const entity of mergedEntities) {
        const normalizedOriginal = entity.original.toLowerCase().trim();

        // Skip duplicates (we'll let EntityStore find all occurrences)
        if (seenOriginals.has(normalizedOriginal)) continue;
        seenOriginals.add(normalizedOriginal);

        const added = EntityStore.addEntity({
            original: entity.original,
            type: entity.type,
            source: entity.source,
            score: entity.score,
            confidence: entity.confidence
        });

        if (added) {
            addedEntities.push(added);
        }
    }

    // Build anonymized text using EntityStore data
    let anonymizedText = '';
    let lastEnd = 0;

    // Get all entities sorted by start position
    const allStoreEntities = EntityStore.getAllEntities();
    const occurrences = [];

    for (const entity of allStoreEntities) {
        for (const occ of entity.occurrences) {
            occurrences.push({
                start: occ.globalStart,
                end: occ.globalEnd,
                replacement: entity.replacement,
                entity: entity
            });
        }
    }

    // Sort by start position
    occurrences.sort((a, b) => a.start - b.start);

    // Remove overlapping occurrences
    const nonOverlapping = [];
    for (const occ of occurrences) {
        if (nonOverlapping.length === 0 || occ.start >= nonOverlapping[nonOverlapping.length - 1].end) {
            nonOverlapping.push(occ);
        }
    }

    // Build anonymized text
    for (const occ of nonOverlapping) {
        anonymizedText += text.slice(lastEnd, occ.start);
        anonymizedText += occ.replacement;
        lastEnd = occ.end;
    }
    anonymizedText += text.slice(lastEnd);

    // Build entities array for compatibility with old API
    const entitiesArray = [];
    for (const occ of nonOverlapping) {
        entitiesArray.push({
            start: occ.start,
            end: occ.end,
            original: text.slice(occ.start, occ.end),
            replacement: occ.replacement,
            type: occ.entity.type,
            source: occ.entity.source,
            score: occ.entity.score,
            confidence: occ.entity.confidence
        });
    }

    // Final summary log
    console.log('========================================');
    console.log('[Anonymizer] buildAnonymizedResult: COMPLETE');
    console.log(`[Anonymizer]   Merged entities: ${mergedEntities.length}`);
    console.log(`[Anonymizer]   Added to EntityStore: ${addedEntities.length}`);
    console.log(`[Anonymizer]   Total occurrences: ${occurrences.length}`);
    console.log(`[Anonymizer]   Non-overlapping occurrences: ${nonOverlapping.length}`);
    console.log(`[Anonymizer]   Final entities array: ${entitiesArray.length}`);
    console.log('========================================');

    return {
        anonymizedText,
        entities: entitiesArray,
        entityMap: EntityStore.exportData()
    };
}

/**
 * Rebuild entities without re-running detection
 */
export function rebuildEntities() {
    console.log('Rebuilding entities from cache');
    return buildAnonymizedResult(currentOriginalText);
}

/**
 * Main anonymization function
 */
export async function anonymize(text, useML = true) {
    reset();
    currentOriginalText = text;

    console.log('========================================');
    console.log('[Anonymizer] ANONYMIZE: STARTING');
    console.log('========================================');
    console.log(`[Anonymizer]   Text length: ${text.length} chars`);
    console.log(`[Anonymizer]   Use ML: ${useML}`);
    console.log(`[Anonymizer]   Model ready: ${isNERModelReady()}`);

    // Detect regex entities
    console.log('[Anonymizer] Running regex detection...');
    cachedRegexEntities = detectRegexEntities(text);
    console.log(`[Anonymizer] Regex entities found: ${cachedRegexEntities.length}`);
    cachedRegexEntities.forEach(e => {
        console.log(`[Anonymizer]   REGEX: "${e.original}" (${e.type})`);
    });

    // Detect ML entities
    cachedMLEntities = [];
    if (useML && isNERModelReady()) {
        console.log('[Anonymizer] Running ML detection...');
        cachedMLEntities = await detectMLEntities(text);
        console.log(`[Anonymizer] ML entities found: ${cachedMLEntities.length}`);
    } else {
        console.log(`[Anonymizer] ML detection SKIPPED: useML=${useML}, modelReady=${isNERModelReady()}`);
    }

    console.log('----------------------------------------');
    console.log(`[Anonymizer] SUMMARY: Regex=${cachedRegexEntities.length}, ML=${cachedMLEntities.length}, Total=${cachedRegexEntities.length + cachedMLEntities.length}`);
    console.log('----------------------------------------');

    return buildAnonymizedResult(text);
}

/**
 * Add a manual entity
 */
export function addManualEntity(original, type, startOffset) {
    // Add to EntityStore
    const entity = EntityStore.addEntity({
        original: original,
        type: type,
        source: 'manual',
        confidence: 'manual'
    });

    return entity;
}

/**
 * Remove an entity
 */
export function removeEntity(original) {
    return EntityStore.removeEntityByOriginal(original);
}

/**
 * Get current entity map (for compatibility)
 */
export function getEntityMap() {
    const map = new Map();
    for (const entity of EntityStore.getAllEntities()) {
        map.set(entity.original.toLowerCase().trim(), {
            token: entity.replacement,
            type: entity.type,
            original: entity.original
        });
    }
    return map;
}

/**
 * Get all detected entities
 */
export function getDetectedEntities() {
    return EntityStore.getAllEntities();
}

/**
 * Get original text
 */
export function getOriginalText() {
    return currentOriginalText;
}
