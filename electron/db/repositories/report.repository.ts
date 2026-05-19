import { getDb } from '../index'
import { v4 as uuidv4 } from 'uuid'
import type { Report, ReportType } from '../../../shared/types/database'

export function getAll(type?: ReportType): Report[] {
  const db = getDb()
  if (type) {
    return db.prepare(
      'SELECT * FROM reports WHERE report_type = ? ORDER BY created_at DESC'
    ).all(type) as Report[]
  }
  return db.prepare('SELECT * FROM reports ORDER BY created_at DESC').all() as Report[]
}

export function getById(id: string): Report | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM reports WHERE id = ?').get(id) as Report | undefined
}

export interface CreateReportData {
  report_type: ReportType
  title: string
  content_markdown: string
  source_context_json?: string | null
}

export function create(data: CreateReportData): Report {
  const db = getDb()
  const id = uuidv4()
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19)
  db.prepare(`
    INSERT INTO reports (id, report_type, title, content_markdown, source_context_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.report_type,
    data.title,
    data.content_markdown,
    data.source_context_json ?? null,
    now
  )
  return getById(id)!
}

export function remove(id: string): boolean {
  const db = getDb()
  const result = db.prepare('DELETE FROM reports WHERE id = ?').run(id)
  return result.changes > 0
}

/** Alias for remove — matches the spec method name */
export const deleteReport = remove
