import * as XLSX from 'xlsx'
import type { StandardItem } from './types'

export async function readStandardsFromQuantXlsx(file: File): Promise<StandardItem[]> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  // Heuristic: find a sheet that contains headers like 标准事项/事项/单价
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false }) as any[][]
    if (!rows.length) continue
    // find header row within first 20 rows
    let headerIdx = -1
    let colItem = -1
    let colPrice = -1
    for (let i=0;i<Math.min(20, rows.length);i++){
      const r = (rows[i]||[]).map(v=>String(v||'').trim())
      const idxItem = r.findIndex(x=>/标准事项|标准项|事项名称|事项/.test(x))
      const idxPrice = r.findIndex(x=>/单价|金额\(元\)|价格/.test(x))
      if (idxItem>=0 && idxPrice>=0){
        headerIdx = i
        colItem = idxItem
        colPrice = idxPrice
        break
      }
    }
    if (headerIdx>=0){
      const out: StandardItem[] = []
      for (let i=headerIdx+1;i<rows.length;i++){
        const r = rows[i]||[]
        const name = String(r[colItem]||'').trim()
        const pRaw = String(r[colPrice]||'').trim()
        if (!name) continue
        const price = parseFloat(pRaw.replace(/[^0-9.]/g,''))
        if (!isFinite(price)) continue
        out.push({ name, price })
      }
      if (out.length) return out
    }
  }
  throw new Error('未能在量化表中识别“事项名称/单价”列。请确认模板含有“标准事项(或事项名称)”与“单价”两列。')
}

export function exportWorkbook(sheets: Record<string, any[]>): Blob {
  const wb = XLSX.utils.book_new()
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = XLSX.utils.json_to_sheet(rows, { skipHeader: false })
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0,31))
  }
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}
