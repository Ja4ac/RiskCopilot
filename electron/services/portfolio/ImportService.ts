// ============================================================
// ImportService — CSV import, preview, commit
// ============================================================

import { v4 as uuid } from 'uuid'
import { getDb } from '../../db'
import type {
  ImportPreviewResult,
  ImportCommitResult,
  ImportRowError
} from '../../../shared/types/database'
import type { IpcImportCsvResult } from '../../../shared/types/ipc'
import * as AssetRepo from '../../db/repositories/asset.repository'
import * as fs from 'fs'
import * as path from 'path'
import { guessMarket } from '../../utils/market-detection'
import { parseCSVLine, detectFieldMapping, applyFieldMapping, validateImportRow } from '../../utils/import-utils'

export class ImportService {
  private recalculatePosition: (assetId: string, accountId: string) => void

  constructor(recalculatePosition: (assetId: string, accountId: string) => void) {
    this.recalculatePosition = recalculatePosition
  }

  /**
   * @deprecated 请使用 previewImport + commitImport 流程替代，该流程支持更灵活的字段映射
   * Import CSV trades from raw text content (backward compatibility).
   * Uses the same BROKER_ALIASES-based field detection as previewImport/commitImport.
   */
  importCSV(csvText: string, accountId: string): IpcImportCsvResult {
    const db = getDb()
    const rows = csvText.trim().split(/\r?\n/)
    if (rows.length < 2) {
      return { success: false, imported: 0, errors: ['CSV is empty or has no data rows'] }
    }

    const headers = parseCSVLine(rows[0])
    const detectedMapping = detectFieldMapping(headers)

    if (Object.keys(detectedMapping).length === 0) {
      return {
        success: false,
        imported: 0,
        errors: ['无法识别 CSV 列头。请确认文件包含证券代码、买卖方向、数量、价格、时间等字段。']
      }
    }

    let imported = 0
    const errors: string[] = []
    const now = new Date().toISOString()
    const recalcSet = new Set<string>()

    const insertTrade = db.prepare(`
      INSERT INTO trades (id, asset_id, account_id, side, quantity, price, fee, tax, trade_time, source, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    for (let i = 1; i < rows.length; i++) {
      if (!rows[i].trim()) continue
      const values = parseCSVLine(rows[i])
      if (values.length === 0) continue

      const rawData: Record<string, string> = {}
      for (let j = 0; j < headers.length; j++) {
        rawData[headers[j]] = values[j] || ''
      }

      const rowErrors = validateImportRow(rawData, detectedMapping)
      if (rowErrors.length > 0) {
        errors.push(`Line ${i + 1}: ${rowErrors.join('; ')}`)
        continue
      }

      const mapped = applyFieldMapping(rawData, detectedMapping)
      const symbol = mapped.symbol
      const side = mapped.side.toLowerCase() as 'buy' | 'sell'
      const quantity = parseFloat(mapped.quantity)
      const price = parseFloat(mapped.price)
      const fee = mapped.fee ? parseFloat(mapped.fee) : 0
      const tax = mapped.tax ? parseFloat(mapped.tax) : 0
      const tradeTime = mapped.trade_time || now

      // Upsert asset using production repository
      const market = guessMarket(symbol)
      const asset = AssetRepo.upsert({ symbol, market, name: symbol })

      const tradeId = uuid()
      insertTrade.run(tradeId, asset.id, accountId, side, quantity, price, fee, tax, tradeTime, 'csv_import', 'active', now)
      recalcSet.add(`${asset.id}:${accountId}`)
      imported++
    }

    // Recalculate all affected positions
    for (const key of recalcSet) {
      const [assetId, accId] = key.split(':')
      this.recalculatePosition(assetId, accId)
    }

    return {
      success: errors.length === 0,
      imported,
      errors
    }
  }

  /**
   * Preview import file — detect headers, map fields, validate rows.
   */
  previewImport(filePath: string): ImportPreviewResult {
    const ext = path.extname(filePath).toLowerCase()
    const rows = this.readFileRows(filePath, ext)

    if (rows.length < 2) {
      return {
        headers: [],
        detected_mapping: {},
        rows: [],
        total_rows: 0,
        valid_rows: 0,
        error_rows: 0,
      }
    }

    const headers = parseCSVLine(rows[0])
    const detectedMapping = detectFieldMapping(headers)
    const resultRows: ImportRowError[] = []
    let validRows = 0
    let errorRows = 0

    for (let i = 1; i < rows.length; i++) {
      if (!rows[i].trim()) continue
      const values = parseCSVLine(rows[i])
      if (values.length === 0) continue

      const rawData: Record<string, string> = {}
      for (let j = 0; j < headers.length; j++) {
        rawData[headers[j]] = values[j] || ''
      }

      const errors = validateImportRow(rawData, detectedMapping)
      if (errors.length > 0) {
        errorRows++
        resultRows.push({ row_index: i, raw_data: rawData, errors })
      } else {
        validRows++
      }
    }

    return {
      headers,
      detected_mapping: detectedMapping,
      rows: resultRows,
      total_rows: validRows + errorRows,
      valid_rows: validRows,
      error_rows: errorRows,
    }
  }

  /**
   * Commit import — map fields, insert trades, recalculate positions.
   */
  commitImport(filePath: string, fieldMapping: Record<string, string>, accountId: string): ImportCommitResult {
    const db = getDb()
    const jobId = uuid()
    const ext = path.extname(filePath).toLowerCase()
    const rows = this.readFileRows(filePath, ext)
    const now = new Date().toISOString()

    if (rows.length < 2) {
      return { job_id: jobId, imported: 0, skipped: 0, errors: [], positions_updated: 0 }
    }

    const headers = parseCSVLine(rows[0])

    // Save import job
    db.prepare(`
      INSERT INTO import_jobs (id, account_id, file_name, file_type, total_rows, status, field_mapping_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?)
    `).run(jobId, accountId, path.basename(filePath), ext.replace('.', ''), rows.length - 1, JSON.stringify(fieldMapping), now, now)

    const insertTrade = db.prepare(`
      INSERT INTO trades (id, asset_id, account_id, side, quantity, price, fee, tax, trade_time, source, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'file_import', 'active', ?)
    `)
    const insertError = db.prepare(`
      INSERT INTO import_errors (id, job_id, row_index, raw_data_json, error_messages_json)
      VALUES (?, ?, ?, ?, ?)
    `)

    let imported = 0
    let skipped = 0
    const errors: ImportRowError[] = []
    const recalcSet = new Set<string>()

    const tx = db.transaction(() => {
      for (let i = 1; i < rows.length; i++) {
        if (!rows[i].trim()) continue
        const values = parseCSVLine(rows[i])
        if (values.length === 0) continue

        const rawData: Record<string, string> = {}
        for (let j = 0; j < headers.length; j++) {
          rawData[headers[j]] = values[j] || ''
        }

        const mapped = applyFieldMapping(rawData, fieldMapping)
        const rowErrors = validateImportRow(rawData, fieldMapping)

        if (rowErrors.length > 0) {
          skipped++
          errors.push({ row_index: i, raw_data: rawData, errors: rowErrors })
          insertError.run(uuid(), jobId, i, JSON.stringify(rawData), JSON.stringify(rowErrors))
          continue
        }

        const symbol = mapped.symbol
        const side = mapped.side?.toLowerCase() as 'buy' | 'sell'
        const quantity = parseFloat(mapped.quantity)
        const price = parseFloat(mapped.price)
        const fee = mapped.fee ? parseFloat(mapped.fee) : 0
        const tax = mapped.tax ? parseFloat(mapped.tax) : 0
        const tradeTime = mapped.trade_time || now

        // Upsert asset
        const market = guessMarket(symbol)
        const existingAsset = AssetRepo.getBySymbol(symbol, market)
        const assetId = existingAsset
          ? existingAsset.id
          : AssetRepo.upsert({ symbol, market, name: symbol }).id

        insertTrade.run(uuid(), assetId, accountId, side, quantity, price, fee, tax, tradeTime, now)
        recalcSet.add(`${assetId}:${accountId}`)
        imported++
      }
    })

    tx()

    // Recalculate positions
    let positionsUpdated = 0
    for (const key of recalcSet) {
      const [assetId, accId] = key.split(':')
      this.recalculatePosition(assetId, accId)
      positionsUpdated++
    }

    // Update job status
    db.prepare(`
      UPDATE import_jobs SET status = 'completed', imported_rows = ?, skipped_rows = ?, error_rows = ?, updated_at = ?
      WHERE id = ?
    `).run(imported, skipped, errors.length, new Date().toISOString(), jobId)

    return { job_id: jobId, imported, skipped, errors, positions_updated: positionsUpdated }
  }

  // ---- Import helpers ----

  private readFileRows(filePath: string, ext: string): string[] {
    const content = fs.readFileSync(filePath, 'utf-8')

    if (ext === '.csv' || ext === '.txt') {
      return content.trim().split(/\r?\n/)
    }

    if (ext === '.xlsx' || ext === '.xls') {
      throw new Error('MVP 版本仅支持 CSV 导入。请将 Excel 文件另存为 CSV 格式后重试。如需 Excel 支持，请运行 npm install xlsx。')
    }

    throw new Error(`不支持的文件格式: ${ext}`)
  }
}
