// Integer sen to "RM 1,500.00". Integer arithmetic only, so no rounding and no float formatting.
export function formatRinggit(sen: number): string {
  if (!Number.isSafeInteger(sen)) throw new Error('Amount must be an integer number of sen')
  const sign = sen < 0 ? '-' : ''
  const abs = Math.abs(sen)
  const ringgit = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${sign}RM ${ringgit}.${String(abs % 100).padStart(2, '0')}`
}
