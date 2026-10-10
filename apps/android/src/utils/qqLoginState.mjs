export function normalizeQrState(code) {
  const value = Number(code)
  if (value === 800) return 'expired'
  if (value === 801) return 'waiting'
  if (value === 802) return 'scanned'
  if (value === 803) return 'confirmed'
  return 'unknown'
}

export function isQrLoginComplete(code) {
  return normalizeQrState(code) === 'confirmed'
}

export function isQrLoginExpired(code) {
  return normalizeQrState(code) === 'expired'
}
