export function normalizeName(raw: string): { name: string; note?: string } {
  const t = (raw || '').trim()
  if (!t) return { name: '' }
  // keep bracket content as note
  const note: string[] = []
  let main = t
  const bracket = t.match(/^(.*?)（(.*)）\s*$/)
  if (bracket) {
    main = bracket[1].trim()
    note.push(bracket[2].trim())
  }
  // remove common suffixes
  main = main.replace(/(同学|同學|老师|老師|同事)\s*$/,'').trim()
  // collapse internal spaces
  main = main.replace(/\s+/g,'')
  return { name: main, note: note.length ? note.join('；') : undefined }
}
