import DocumentTemplate from '#models/document_template'
import DocumentTemplateVersion from '#models/document_template_version'

/**
 * The templates every Instance starts with, seeded by migrations: the
 * work report (#180).
 */
export const SEEDED_TEMPLATES = ['Rapportino di lavoro']

/**
 * The Document Templates a test added, leaving out the seeded ones.
 */
export function addedTemplates() {
  return DocumentTemplate.query().whereNotIn('name', SEEDED_TEMPLATES)
}

/**
 * The versions of the templates a test added (a seeded template's first
 * version has its name).
 */
export function addedVersions() {
  return DocumentTemplateVersion.query().whereNotIn('name', SEEDED_TEMPLATES)
}
