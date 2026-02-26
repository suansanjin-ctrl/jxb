import type { PersonMonthAgg, AllocationResult } from './types'

export function allocate800(
  aggs: PersonMonthAgg[],
  priorityCollectors: string[] = []
): AllocationResult {
  // Combine by person across months for payment (usually pay by person total)
  const people = new Map<string, { raw: number, items: PersonMonthAgg[] }>()
  for (const a of aggs){
    const p = people.get(a.person) || { raw: 0, items: [] }
    p.raw += a.total
    p.items.push(a)
    people.set(a.person, p)
  }

  const rows = [...people.entries()].map(([name, v]) => ({
    name,
    raw: round2(v.raw),
    pay0: round2(Math.min(800, v.raw)),
    overflow: round2(Math.max(0, v.raw - 800)),
  }))

  const collectors = rows
    .filter(r=>r.pay0 < 800)
    .map(r=>({ name: r.name, cap: round2(800 - r.pay0), from: [] as {src: string, amt: number}[] }))

  // sorting: priority first, then cap desc
  const prioritySet = new Map<string, number>()
  priorityCollectors.forEach((n,i)=>prioritySet.set(n, i))

  function pickCollectors(): {name: string, cap: number, from: {src: string, amt: number}[]}[] {
    return collectors
      .filter(c=>c.cap > 0.0001)
      .sort((a,b)=>{
        const pa = prioritySet.has(a.name) ? prioritySet.get(a.name)! : 999999
        const pb = prioritySet.has(b.name) ? prioritySet.get(b.name)! : 999999
        if (pa !== pb) return pa - pb
        return b.cap - a.cap
      })
  }

  const warnings: string[] = []
  // allocate each overflow source; to minimize collectors, we fill in the above order
  const transfers: { from: string, to: string, amt: number, reason: string }[] = []

  for (const src of rows.filter(r=>r.overflow>0)){
    let remaining = src.overflow
    const picked = pickCollectors()
    if (picked.length === 0){
      warnings.push(`容量不足：无人可代收。缺口金额=${round2(remaining)}`)
      break
    }
    for (const c of picked){
      if (remaining <= 0.0001) break
      const give = round2(Math.min(c.cap, remaining))
      if (give <= 0) continue
      c.cap = round2(c.cap - give)
      c.from.push({ src: src.name, amt: give })
      remaining = round2(remaining - give)

      transfers.push({ from: c.name, to: src.name, amt: give, reason: '代收超出部分' })
    }
    if (remaining > 0.0001){
      warnings.push(`容量不足：${src.name} 的超出部分仍有缺口 ${round2(remaining)}，需要新增代收账户数≈${Math.ceil(remaining/800)}`)
    }
    if (src.overflow > 0 && picked.filter(c=>c.from.some(x=>x.src===src.name)).length > 1){
      warnings.push(`${src.name} 超出部分需多人代收（已拆分）`)
    }
  }

  // Build E table: each account one row
  const E = rows.map(r=>{
    const c = collectors.find(x=>x.name===r.name)
    const recv = c ? sum(c.from.map(x=>x.amt)) : 0
    const final = round2(r.pay0 + recv)
    return {
      '姓名（账户）': r.name,
      '原始应得金额': r.raw,
      '本人到账金额（≤800）': r.pay0,
      '超出部分': r.overflow,
      '代收来源明细': c ? c.from.map(x=>`${x.src}/${x.amt}`).join('；') : '',
      '该账户最终到账金额（≤800）': final,
      '剩余容量': c ? round2(800 - final) : round2(800 - r.pay0),
      '备注': ''
    }
  })

  // Merge transfers same (from,to)
  const keyMap = new Map<string, number>()
  for (const t of transfers){
    const key = `${t.from}__${t.to}__${t.reason}`
    keyMap.set(key, round2((keyMap.get(key)||0) + t.amt))
  }
  const F = [...keyMap.entries()].map(([k, amt])=>{
    const [from,to,reason] = k.split('__')
    return {
      '转出人（代收人）': from,
      '转入人（实际应得者）': to,
      '转账金额': amt,
      '原因': reason,
      '备注': ''
    }
  })

  // Consistency check
  const totalRaw = round2(sum(rows.map(r=>r.raw)))
  const totalFinal = round2(sum(E.map((r:any)=>Number(r['该账户最终到账金额（≤800）']||0))))
  if (Math.abs(totalRaw - totalFinal) > 0.01){
    warnings.push(`一致性校验失败：最终到账合计=${totalFinal} ≠ 原始应得合计=${totalRaw}`)
  } else {
    warnings.push(`一致性校验通过：最终到账合计=${totalFinal} = 原始应得合计=${totalRaw}`)
  }

  return { E, F, warnings }
}

function sum(a: number[]): number { return a.reduce((x,y)=>x+y,0) }
function round2(n: number): number { return Math.round(n*100)/100 }
