import JSZip from 'jszip'

function stripXml(s: string): string {
  return s
    .replace(/<w:tab\s*\/>/g, '\t')
    .replace(/<w:br\s*\/>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g,'&')
    .replace(/&lt;/g,'<')
    .replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"')
    .replace(/&#39;/g,"'")
}

function normText(s: string): string {
  return (s||'')
    .replace(/\u00a0/g,' ')
    .replace(/[\r\t]+/g,' ')
    .replace(/\n{3,}/g,'\n\n')
    .replace(/[ ]{2,}/g,' ')
    .trim()
}

function isTemplateWord(s: string): boolean {
  const t = s.trim()
  if (!t) return true
  // adjust here if your template has fixed words
  return /^(所属部门\/?组|主席团|部门|组别)$/.test(t)
}

/**
 * Parse first table into rows[cellsText[]]
 * Works for typical docx where text is in <w:t>.
 */
export async function parseDocxTables(file: File): Promise<string[][][]> {
  const buf = await file.arrayBuffer()
  const zip = await JSZip.loadAsync(buf)
  const docXml = await zip.file('word/document.xml')?.async('string')
  if (!docXml) throw new Error('docx 中未找到 word/document.xml')
  const tables: string[][][] = []
  // naive parse: split by <w:tbl>
  const tblParts = docXml.split('<w:tbl')
  for (let i=1;i<tblParts.length;i++){
    const tblXml = '<w:tbl' + tblParts[i]
    const tblBody = tblXml.split('</w:tbl>')[0]
    const rowsXml = tblBody.split('<w:tr')
    const rows: string[][] = []
    for (let j=1;j<rowsXml.length;j++){
      const tr = '<w:tr' + rowsXml[j]
      const trBody = tr.split('</w:tr>')[0]
      const cellsXml = trBody.split('<w:tc')
      const cells: string[] = []
      for (let k=1;k<cellsXml.length;k++){
        const tc = '<w:tc' + cellsXml[k]
        const tcBody = tc.split('</w:tc>')[0]
        // collect all w:t
        const texts: string[] = []
        const parts = tcBody.split('<w:t')
        for (let p=1;p<parts.length;p++){
          const seg = '<w:t' + parts[p]
          const content = seg.split('</w:t>')[0]
          const after = content.split('>')[1] ?? ''
          texts.push(after)
        }
        const raw = stripXml(texts.join(''))
        cells.push(normText(raw))
      }
      if (cells.some(c=>c.trim().length>0)) rows.push(cells)
    }
    if (rows.length) tables.push(rows)
  }
  return tables
}

export function extractLabelValueRows5Cols(rows: string[][]): { label: string; value: string; rawCols: string[] }[] {
  const out: { label: string; value: string; rawCols: string[] }[] = []
  for (const r of rows){
    if (!r.length) continue
    const label = (r[0]||'').trim()
    const cols = [r[1]||'', r[2]||'', r[3]||'', r[4]||'']
    // clean and dedupe
    const cleaned = cols.map(c=>normText(c))
    const nonEmpty = cleaned.filter(c=>c && !isTemplateWord(c))
    let value = ''
    if (cleaned[0] && !isTemplateWord(cleaned[0])) value = cleaned[0]
    else {
      // choose the longest non-template string
      value = nonEmpty.sort((a,b)=>b.length-a.length)[0] || ''
    }
    // if many identical long strings, keep one
    // (already by selecting one)
    if (label) out.push({ label, value, rawCols: cleaned })
  }
  return out
}
