const SECRET_KEY_ALIASES = new Set([
  'cookie', 'cookies', 'cookielist', 'cookieobject', 'cookiestring', 'cookiemap', 'cookiejar',
  'qrsig', 'ptqrtoken', 'authorization', 'proxyauthorization', 'xauthorization',
  'token', 'accesstoken', 'refreshtoken', 'idtoken', 'authtoken', 'sessiontoken', 'logintoken',
  'setcookie', 'skey', 'pskey', 'qqmusickey', 'qqmusicuin', 'pt4token', 'qmkeyst', 'qmcookie',
  'ptcz', 'p_uin', 'puin', 'euin', 'hosteuin', 'encryptuin', 'encrypteduin', 'gtk', 'loginsig',
  'cookieheader', 'cookievalue', 'rawcookie', 'cookiedata', 'ticket',
])

const SECRET_TEXT_SOURCE = String.raw`\b(?:cookies?(?:[-_\s]*(?:string|map|object|list|jar|header|value|data))?|raw[-_\s]*cookie|qr[-_\s]*sig|ptqr[-_\s]*token|pt4[-_\s]*token|(?:proxy|x)?[-_\s]*authorization|(?:id|auth|access|refresh|session|login)[-_\s]*token|token|p?[-_\s]*skey|p[-_\s]*uin|qqmusic[-_\s]*(?:key|uin)|qm[-_\s]*keyst|qmcookie|ptcz|(?:host|encrypt(?:ed)?)[-_\s]*euin|euin|g[-_\s]*tk|login[-_\s]*sig|ticket)\s*[:=]\s*[^\s;,]+|\bBearer\s+[^\s,;]+`

function canonicalizeQQKey(key) {
  return String(key || '').replace(/[^a-z0-9]/gi, '').toLowerCase()
}

export function isQQSecretKey(key) {
  const canonical = canonicalizeQQKey(key)
  return SECRET_KEY_ALIASES.has(canonical)
    || canonical.endsWith('accesstoken')
    || canonical.endsWith('refreshtoken')
}

function sanitizeQQText(value) {
  return String(value).replace(new RegExp(SECRET_TEXT_SOURCE, 'gi'), (match) => {
    if (/^Bearer\s/i.test(match)) return 'Bearer [REDACTED]'
    const separatorIndex = match.search(/[:=]/)
    const separator = match[separatorIndex]
    return `${match.slice(0, separatorIndex + 1)}${separator === ':' ? ' ' : ''}[REDACTED]`
  })
}

function containsQQSecretText(value) {
  const matches = String(value).match(new RegExp(SECRET_TEXT_SOURCE, 'gi')) || []
  return matches.some(match => !/\[REDACTED\]\s*$/i.test(match))
}

export function sanitizeQQPayload(value, seen = new WeakSet()) {
  if (typeof value === 'string') return sanitizeQQText(value)
  if (Array.isArray(value)) return value.map(item => sanitizeQQPayload(item, seen))
  if (!value || typeof value !== 'object') return value
  if (seen.has(value)) return null
  seen.add(value)

  const safe = {}
  for (const [key, item] of Object.entries(value)) {
    if (isQQSecretKey(key)) continue
    safe[key] = sanitizeQQPayload(item, seen)
  }
  return safe
}

export function containsQQSecret(value, seen = new WeakSet()) {
  if (typeof value === 'string') return containsQQSecretText(value)
  if (!value || typeof value !== 'object') return false
  if (seen.has(value)) return false
  seen.add(value)
  return Object.entries(value).some(([key, item]) => isQQSecretKey(key) || containsQQSecret(item, seen))
}
