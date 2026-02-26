import React, { useMemo, useState } from 'react'
import type { MatchedItem, PersonMonthAgg } from './lib/types'
import { readStandardsFromQuantXlsx, exportWorkbook } from './lib/xlsx'
import { parseDocxTables, extractLabelValueRows5Cols } from './lib/docxTable'
import { extractFromFormFields, aggregate } from './lib/extract'
import { allocate800 } from './lib/allocate800'

type TabKey = 'A明细'|'B量化'|'C汇总'|'D异常'|'E分配'|'F转账'|'日志'

export default function App() {
  const [quantFile, setQuantFile] = useState<File|null>(null)
  const [perfFiles, setPerfFiles] = useState<File[]>([])
  const [priorityText, setPriorityText] = useState('')
  const [running, setRunning] = useState(false)
  const [tab, setTab] = useState<TabKey>('A明细')

  const [standards, setStandards] = useState<{name: string, price: number}[]>([])
  const [matched, setMatched] = useState<MatchedItem[]>([])
  const [aggs, setAggs] = useState<PersonMonthAgg[]>([])
  const [exceptions, setExceptions] = useState<any[]>([])
  const [alloc, setAlloc] = useState<{E:any[],F:any[],warnings:string[]}>({E:[],F:[],warnings:[]})

  async function run() {
    if (!quantFile) return alert('请先上传量化表 xlsx')
    if (!perfFiles.length) return alert('请上传至少一份绩效表（docx/xlsx）')
    setRunning(true)
    try {
      const std = await readStandardsFromQuantXlsx(quantFile)
      setStandards(std)

      const allMatched: MatchedItem[] = []
      const allExceptions: any[] = []

      for (const f of perfFiles){
        const name = f.name.toLowerCase()
        if (name.endsWith('.docx')){
          const tables = await parseDocxTables(f)
          if (!tables.length) {
            allExceptions.push({ 月份:'', 姓名:'', 原文: f.name, 问题类型:'无法解析', 建议匹配项:'未读取到表格', 匹配方式:'无法匹配', 操作说明:'docx 未解析到 <w:tbl> 表格' })
            continue
          }
          // Heuristic: pick the largest table
          const table = tables.sort((a,b)=>b.length-a.length)[0]
          const rows = extractLabelValueRows5Cols(table)
          const fields = rows.map(r=>({ label: r.label, value: r.value }))
          const { matched, exceptions } = extractFromFormFields(f.name, fields, std)
          allMatched.push(...matched)
          allExceptions.push(...exceptions)
        } else {
          allExceptions.push({ 月份:'', 姓名:'', 原文: f.name, 问题类型:'暂不支持', 建议匹配项:'请优先使用docx模板或自行扩展xlsx解析', 匹配方式:'无法匹配', 操作说明:'当前版本重点适配docx模板' })
        }
      }

      const ag = aggregate(allMatched)
      const priority = priorityText.split(/\s*[\n,，;；]\s*/).map(s=>s.trim()).filter(Boolean)
      const al = allocate800(ag, priority)

      setMatched(allMatched)
      setAggs(ag)
      setExceptions(allExceptions)
      setAlloc(al)
      setTab('A明细')
    } catch (e:any) {
      console.error(e)
      alert(e?.message || String(e))
    } finally {
      setRunning(false)
    }
  }

  const A = useMemo(()=>{
    // per person per month one row; items list no counts
    return aggs.map(a=>{
      const items = a.workItemNames.sort()
      const breakdown = items.map(n=>`${n}:${(a.itemAmounts[n]||0).toFixed(2)}`).join('；')
      return {
        '月份': a.month,
        '姓名': a.person,
        '标准事项汇总': items.join('+'),
        '分项金额说明': breakdown,
        '合计金额': a.total.toFixed(2),
        '原文摘录（可选）': ''
      }
    })
  },[aggs])

  const C = useMemo(()=>{
    // person one row (sum across months)
    const map = new Map<string, { items:Set<string>, counts: Record<string, number>, amounts: Record<string, number>, total:number }>()
    for (const a of aggs){
      const p = map.get(a.person) || { items: new Set<string>(), counts: {}, amounts: {}, total: 0 }
      for (const it of a.workItemNames){
        p.items.add(it)
        p.counts[it] = (p.counts[it]||0) + (a.itemCounts[it]||0)
        p.amounts[it] = (p.amounts[it]||0) + (a.itemAmounts[it]||0)
      }
      p.total += a.total
      map.set(a.person, p)
    }
    const rows:any[] = []
    for (const [name, p] of [...map.entries()].sort((a,b)=>a[0].localeCompare(b[0]))){
      const list = [...p.items].sort()
      const detail = list.map(it=>`${it}(${p.counts[it]}次/${p.amounts[it].toFixed(2)})`).join('；')
      const raw = p.total
      const pay = Math.min(800, raw)
      const overflow = Math.max(0, raw-800)
      rows.push({
        '姓名': name,
        '工作事项列表': list.join('+'),
        '各标准事项（次数+小计）': detail,
        '原始应得合计金额': raw.toFixed(2),
        '本人到账金额（封顶后）': pay.toFixed(2),
        '超出部分': overflow.toFixed(2),
        '备注': ''
      })
    }
    return rows
  },[aggs])

  const B = useMemo(()=>{
    // a simple quant matrix: one row per person per month, columns = standard items
    const itemNames = standards.map(s=>s.name)
    const rows:any[] = []
    for (const a of aggs){
      const r:any = { '月份': a.month, '姓名': a.person }
      for (const n of itemNames) r[n] = a.itemCounts[n] || 0
      r['合计金额'] = a.total.toFixed(2)
      rows.push(r)
    }
    return rows
  },[aggs, standards])

  function exportXlsx(){
    const blob = exportWorkbook({
      'A明细表': A,
      'B量化表(简化)': B,
      'C个人汇总表': C,
      'D异常待确认表': exceptions,
      'E金额分配表': alloc.E,
      'F转账通知表': alloc.F,
      '校验与提示': alloc.warnings.map(w=>({ '提示': w })),
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `绩效结算_导出.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  const tabs: TabKey[] = ['A明细','B量化','C汇总','D异常','E分配','F转账','日志']

  const tableData = useMemo(()=>{
    switch(tab){
      case 'A明细': return A
      case 'B量化': return B
      case 'C汇总': return C
      case 'D异常': return exceptions
      case 'E分配': return alloc.E
      case 'F转账': return alloc.F
      case '日志': return alloc.warnings.map(w=>({ '提示': w }))
    }
  },[tab, A, B, C, exceptions, alloc])

  return (
    <div className="container">
      <div className="card">
        <div className="row">
          <div style={{flex: '1 1 360px'}}>
            <label>1）上传《量化表模板》xlsx（含“标准事项/单价”列）</label>
            <input type="file" accept=".xlsx" onChange={(e)=>{
              const f = e.target.files?.[0] || null
              setQuantFile(f)
            }} />
          </div>
          <div style={{flex: '1 1 360px'}}>
            <label>2）上传绩效表（支持多份 docx；当前版本优先适配你们5列表格模板）</label>
            <input type="file" accept=".docx,.xlsx,.png,.jpg,.jpeg" multiple onChange={(e)=>{
              const fs = Array.from(e.target.files || [])
              setPerfFiles(fs)
            }} />
          </div>
        </div>

        <div style={{marginTop: 10}}>
          <label>（可选）优先代收人名单（按优先级；用换行/逗号分隔）</label>
          <textarea value={priorityText} onChange={e=>setPriorityText(e.target.value)} placeholder="例如：A\nB\nC" />
        </div>

        <div className="row" style={{alignItems:'center', marginTop: 10}}>
          <button className="primary" disabled={running} onClick={run}>
            {running ? '处理中…' : '开始解析与结算'}
          </button>
          <button disabled={!aggs.length} onClick={exportXlsx}>导出 Excel（A~F + 校验）</button>
          <span className="small">
            说明：本工具纯前端离线运行；docx 解析按“第1列=字段标签、第2~5列=内容区去重取值”规则防止重复计次。
          </span>
        </div>
      </div>

      <div className="card">
        <div className="tabs">
          {tabs.map(t=>(
            <div key={t} className={'tab'+(t===tab?' active':'')} onClick={()=>setTab(t)}>{t}</div>
          ))}
        </div>
        <DataTable data={tableData} />
      </div>

      <div className="card">
        <div className="badge">当前解析统计</div>
        <div className="small">标准事项数：{standards.length}；匹配明细条数：{matched.length}；按人月汇总行数：{aggs.length}；异常行数：{exceptions.length}</div>
      </div>
    </div>
  )
}

function DataTable({ data }: { data: any[] }) {
  const cols = useMemo(()=>{
    const set = new Set<string>()
    for (const r of data || []) Object.keys(r||{}).forEach(k=>set.add(k))
    return [...set]
  },[data])
  if (!data || !data.length) return <div className="small">暂无数据</div>
  return (
    <div style={{overflow:'auto'}}>
      <table>
        <thead>
          <tr>{cols.map(c=><th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {data.map((r,i)=>(
            <tr key={i}>
              {cols.map(c=><td key={c}>{String(r?.[c] ?? '')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
