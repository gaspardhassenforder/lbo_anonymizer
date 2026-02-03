-- Add pages_json column to documents table to store PageModels
-- This allows loading documents without re-running OCR

ALTER TABLE documents ADD COLUMN pages_json TEXT DEFAULT '[]';
