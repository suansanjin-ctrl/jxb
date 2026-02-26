const CN_MAP: Record<string, number> = {
  '零':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,
  '十':10,'百':100,'千':1000,'万':10000
}

export function cnToNumber(s: string): number | null {
  s = s.trim()
  if (!s) return null
  if (/^\d+$/.test(s)) return parseInt(s,10)

  // handle simple forms up to 99: 十, 十三, 二十, 二十三
  if (s === '十') return 10
  const m1 = s.match(/^十([一二两三四五六七八九])$/)
  if (m1) return 10 + CN_MAP[m1[1]]
  const m2 = s.match(/^([一二两三四五六七八九])十$/)
  if (m2) return CN_MAP[m2[1]] * 10
  const m3 = s.match(/^([一二两三四五六七八九])十([一二两三四五六七八九])$/)
  if (m3) return CN_MAP[m3[1]]*10 + CN_MAP[m3[2]]

  // fallback: try accumulate with 十百千 (very small scope)
  let total = 0
  let current = 0
  for (const ch of s) {
    const v = CN_MAP[ch]
    if (v == null) return null
    if (v >= 10) {
      if (current === 0) current = 1
      total += current * v
      current = 0
    } else {
      current = current * 10 + v
    }
  }
  total += current
  return total || null
}
