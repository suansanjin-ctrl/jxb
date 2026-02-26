import type { StandardItem, MatchedItem, PersonMonthAgg } from './types'
import { cnToNumber } from './cnNumber'
import { normalizeName } from './nameNormalize'

function findMonthFromText(t: string): string | null {
  // matches 12月, 2025年12月, 12
  const m1 = t.match(/(\d{1,2})\s*月/)
  if (m1) return `${parseInt(m1[1],10)}`
  const m2 = t.match(/^\s*(\d{1,2})\s*$/)
  if (m2) return `${parseInt(m2[1],10)}`
  const m3 = t.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/)
  if (m3) return `${parseInt(m3[2],10)}`
  return null
}

function hasZeroSignal(t: string): boolean {
  return /(无|空白|未填写|没有|未做)/.test(t)
}

function extractParenCount(block: string): number | null {
  // （8）次 or (8)次
  const m = block.match(/[（(]\s*(\d+)\s*[)）]\s*次/)
  if (m) return parseInt(m[1],10)
  return null
}

function extractCountAnywhere(t: string): number | null {
  // 3次 / 三次 / 共3场 / 2篇 / 1条 / 1张 / 1个 / 1人 / 1月
  const m = t.match(/(共\s*)?([0-9]{1,3}|[零一二两三四五六七八九十百千]+)\s*(次|场|篇|条|张|个|人|月)/)
  if (!m) return null
  const n = cnToNumber(m[2])
  return n == null ? null : n
}

function splitListItems(block: string): string[] {
  // split by numbering and punctuation; keep meaningful segments
  const t = block.replace(/\r/g,'')
  // normalize numbering like 1. 1、 （1）
  const norm = t.replace(/\n+/g,'\n')
  let parts = norm.split(/(?:\n\s*\d+[\.、]|\n\s*[（(]\d+[)）]|\n\s*[-•]|；|;|、|，|,)/)
  parts = parts.map(p=>p.trim()).filter(p=>p && p.length>1)
  return parts
}

function matchStandard(rawItem: string, standards: StandardItem[]): { name: string; mode: MatchedItem['matchMode']; opNote?: string; candidates?: string[] } | null {
  const s = rawItem.trim()
  if (!s) return null
  // exact contains match
  const exact = standards.find(it => s === it.name)
  if (exact) return { name: exact.name, mode: '精确匹配' }

  // naive synonym heuristics for lecture tier
  // If contains "讲解" treat as "讲解" related; actual tier handled earlier
  // Otherwise fuzzy: pick by character overlap score
  function score(a: string, b: string): number {
    const setA = new Set(a.split(''))
    const setB = new Set(b.split(''))
    let inter = 0
    for (const ch of setA) if (setB.has(ch)) inter++
    return inter / Math.max(1, Math.min(setA.size, setB.size))
  }
  const ranked = standards
    .map(it => ({ name: it.name, sc: score(s, it.name) }))
    .sort((x,y)=>y.sc-x.sc)
  const top = ranked.slice(0,3)
  if (top[0] && top[0].sc >= 0.6) {
    return { name: top[0].name, mode: '近义匹配', opNote: `字符重合度≈${top[0].sc.toFixed(2)}`, candidates: top.map(x=>`${x.name}(${x.sc.toFixed(2)})`) }
  }
  return { name: '', mode: '无法匹配', opNote: '相似度不足', candidates: top.map(x=>`${x.name}(${x.sc.toFixed(2)})`) }
}

function pickLectureTier(text: string): '讲解（跨校区）' | '紧急讲解' | '重要/复杂讲解' | '讲解' {
  if (/(跨校区|外校区|分校区|去\S{0,10}校区)/.test(text)) return '讲解（跨校区）'
  if (/(紧急|加急|临时)/.test(text)) return '紧急讲解'
  if (/(重要|复杂|重点|大型|接待领导|领导|专家)/.test(text)) return '重要/复杂讲解'
  return '讲解'
}

export function extractFromFormFields(
  fileName: string,
  fields: { label: string; value: string }[],
  standards: StandardItem[]
): { matched: MatchedItem[]; exceptions: any[] } {
  let month: string | null = null
  let nameRaw = ''
  const exceptions: any[] = []
  for (const f of fields){
    if (/考核月份/.test(f.label)) {
      const m = findMonthFromText(f.value)
      if (m) month = m
    }
    if (/姓名/.test(f.label)) {
      nameRaw = f.value
    }
  }
  const n = normalizeName(nameRaw)
  if (!n.name) {
    exceptions.push({ 月份: month||'', 姓名: '', 原文: nameRaw||'(空)', 问题类型: '缺姓名', 建议匹配项: '请补充姓名', 匹配方式: '无法匹配', 操作说明: '未在“姓名”字段解析到有效姓名' })
  }
  if (!month) {
    // try from file name like 12月
    const fm = findMonthFromText(fileName)
    if (fm) {
      month = fm
      exceptions.push({ 月份: month, 姓名: n.name, 原文: fileName, 问题类型: '月份缺失', 建议匹配项: '月份来源=文件名', 匹配方式: '人工推断', 操作说明: '正文缺“考核月份”，改用文件名推断月份' })
    }
  }
  const monthStr = month || ''

  // helper to add exception about mismatch
  function addMismatchIssue(kind: string, total: number, listed: number, source: string){
    exceptions.push({
      月份: monthStr,
      姓名: n.name,
      原文: source,
      问题类型: '不一致',
      建议匹配项: `${kind} 不一致：总次数=${total}，列举=${listed}`,
      匹配方式: '人工推断',
      操作说明: '按总次数计价，列表仅作佐证'
    })
  }

  const matched: MatchedItem[] = []

  for (const f of fields){
    const block = (f.value||'').trim()
    if (!block) continue
    if (hasZeroSignal(block)) {
      // treat as zero; record if label is a work section
      if (/(讲解|阶段工作|杂活)/.test(f.label)){
        exceptions.push({ 月份: monthStr, 姓名: n.name, 原文: `${f.label}: ${block}`, 问题类型: '无效/空白', 建议匹配项: '按0次处理', 匹配方式: '精确匹配', 操作说明: '检测到“无/未做/空白”等信号，计0不计价' })
      }
      continue
    }

    if (/讲解工作/.test(f.label)){
      // extract lecture total and list
      const total = extractParenCount(block) ?? extractCountAnywhere(block) ?? 1
      const list = splitListItems(block)
      if (total != null && list.length && total !== list.length) addMismatchIssue('讲解', total, list.length, block)
      const tier = pickLectureTier(block)
      // match to standard item tier if exists; fallback to '讲解'
      const stdName = standards.some(x=>x.name===tier) ? tier : (standards.some(x=>x.name==='讲解') ? '讲解' : tier)
      const std = standards.find(x=>x.name===stdName)
      if (!std){
        exceptions.push({ 月份: monthStr, 姓名: n.name, 原文: block, 问题类型: '未匹配', 建议匹配项: `量化表缺少事项：${stdName}`, 匹配方式: '无法匹配', 操作说明: '讲解档位已判断，但量化表无对应标准项' })
      } else {
        matched.push({
          month: monthStr,
          person: n.name,
          personNote: n.note,
          standardName: std.name,
          count: total ?? 1,
          unitPrice: std.price,
          amount: (total ?? 1) * std.price,
          sourceText: block,
          matchMode: '人工推断',
          opNote: `按讲解档位规则判断为“${std.name}”，并以总次数计价`,
          candidates: [tier]
        })
      }
    }

    if (/阶段工作/.test(f.label)){
      const total = extractParenCount(block) ?? extractCountAnywhere(block) ?? 1
      const list = splitListItems(block)
      if (total != null && list.length && total !== list.length) addMismatchIssue('阶段工作', total, list.length, block)

      // distribute counts across matched standard items from list; if list empty just treat as one generic item
      const items = list.length ? list : [block]
      // match each item and count; but respect total: if total provided, default 1 per item then scale/clip
      const perCounts = new Array(items.length).fill(1)
      const sumPer = perCounts.reduce((a,b)=>a+b,0)
      let scale = 1
      if (total != null) scale = total / sumPer
      // We'll allocate floor then remainder to first items
      const alloc = perCounts.map(()=>0)
      if (total != null) {
        let used = 0
        for (let i=0;i<items.length;i++){
          alloc[i] = Math.floor(scale)
          used += alloc[i]
        }
        let rem = total - used
        let i=0
        while (rem>0 && items.length){
          alloc[i%items.length] += 1
          rem--; i++
        }
      } else {
        alloc.fill(1)
      }

      for (let i=0;i<items.length;i++){
        const mi = matchStandard(items[i], standards)
        if (!mi) continue
        if (mi.mode === '无法匹配' || !mi.name){
          exceptions.push({ 月份: monthStr, 姓名: n.name, 原文: items[i], 问题类型: '未匹配', 建议匹配项: (mi?.candidates||[]).join('；'), 匹配方式: mi?.mode||'无法匹配', 操作说明: `阶段工作条目无法可靠匹配标准项：${mi?.opNote||''}` })
          continue
        }
        const std = standards.find(x=>x.name===mi.name)!
        const cnt = alloc[i] || 1
        matched.push({
          month: monthStr,
          person: n.name,
          personNote: n.note,
          standardName: std.name,
          count: cnt,
          unitPrice: std.price,
          amount: cnt * std.price,
          sourceText: items[i],
          matchMode: mi.mode,
          opNote: mi.opNote,
          candidates: mi.candidates
        })
        if (mi.mode !== '精确匹配'){
          exceptions.push({ 月份: monthStr, 姓名: n.name, 原文: items[i], 问题类型: '近义/推断', 建议匹配项: mi.name, 匹配方式: mi.mode, 操作说明: `将原文归到“${mi.name}”：${mi.opNote||''}；候选：${(mi.candidates||[]).join('；')}` })
        }
      }
    }

    if (/杂活/.test(f.label)){
      const total = extractParenCount(block) ?? extractCountAnywhere(block) ?? 1
      const list = splitListItems(block)
      if (total != null && list.length && total !== list.length) addMismatchIssue('杂活', total, list.length, block)

      const items = list.length ? list : [block]
      const alloc = new Array(items.length).fill(1)
      if (total != null) {
        // similar allocation
        let used = 0
        for (let i=0;i<items.length;i++){ alloc[i]=0 }
        let rem = total
        let i=0
        while (rem>0 && items.length){
          alloc[i%items.length] += 1
          rem--; i++
        }
      }

      for (let i=0;i<items.length;i++){
        const mi = matchStandard(items[i], standards)
        if (!mi) continue
        if (mi.mode === '无法匹配' || !mi.name){
          exceptions.push({ 月份: monthStr, 姓名: n.name, 原文: items[i], 问题类型: '未匹配', 建议匹配项: (mi?.candidates||[]).join('；'), 匹配方式: mi?.mode||'无法匹配', 操作说明: `杂活条目无法可靠匹配标准项：${mi?.opNote||''}` })
          continue
        }
        const std = standards.find(x=>x.name===mi.name)!
        const cnt = alloc[i] || 1
        matched.push({
          month: monthStr,
          person: n.name,
          personNote: n.note,
          standardName: std.name,
          count: cnt,
          unitPrice: std.price,
          amount: cnt * std.price,
          sourceText: items[i],
          matchMode: mi.mode,
          opNote: mi.opNote,
          candidates: mi.candidates
        })
        if (mi.mode !== '精确匹配'){
          exceptions.push({ 月份: monthStr, 姓名: n.name, 原文: items[i], 问题类型: '近义/推断', 建议匹配项: mi.name, 匹配方式: mi.mode, 操作说明: `将原文归到“${mi.name}”：${mi.opNote||''}；候选：${(mi.candidates||[]).join('；')}` })
        }
      }
    }
  }

  return { matched, exceptions }
}

export function aggregate(matched: MatchedItem[]): PersonMonthAgg[] {
  const map = new Map<string, PersonMonthAgg>()
  for (const m of matched){
    if (!m.person || !m.month) continue
    const key = `${m.month}__${m.person}`
    let agg = map.get(key)
    if (!agg){
      agg = { month: m.month, person: m.person, workItemNames: [], itemCounts: {}, itemAmounts: {}, total: 0, notes: [] }
      map.set(key, agg)
    }
    agg.itemCounts[m.standardName] = (agg.itemCounts[m.standardName]||0) + m.count
    agg.itemAmounts[m.standardName] = (agg.itemAmounts[m.standardName]||0) + m.amount
    agg.total += m.amount
    if (!agg.workItemNames.includes(m.standardName)) agg.workItemNames.push(m.standardName)
    if (m.personNote) agg.notes.push(m.personNote)
  }
  return [...map.values()].sort((a,b)=>a.month.localeCompare(b.month) || a.person.localeCompare(b.person))
}
