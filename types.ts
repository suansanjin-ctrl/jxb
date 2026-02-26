export type RawItem = {
  fileName: string
  month?: string
  nameRaw: string
  text: string
  rowHint?: string
}

export type StandardItem = {
  name: string
  price: number
}

export type MatchedItem = {
  month: string
  person: string
  personNote?: string
  standardName: string
  count: number
  unitPrice: number
  amount: number
  sourceText: string
  matchMode: '精确匹配' | '近义匹配' | '人工推断' | '无法匹配'
  opNote?: string
  candidates?: string[]
  issueType?: string
}

export type PersonMonthAgg = {
  month: string
  person: string
  workItemNames: string[] // unique standard names
  itemCounts: Record<string, number>
  itemAmounts: Record<string, number>
  total: number
  notes: string[]
}

export type AllocationResult = {
  E: any[]
  F: any[]
  warnings: string[]
}
