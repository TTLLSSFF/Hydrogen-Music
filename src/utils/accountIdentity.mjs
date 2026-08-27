// Library requests use a composite key so a NetEase and QQ session can be
// tracked independently. API calls still need the provider's individual ID.
export function getMusicAccountId(accountKey, provider = 'netease') {
  const value = String(accountKey ?? '')
  const separator = value.indexOf(':')
  if (separator < 0) return value
  const normalizedProvider = String(provider || '').trim().toLowerCase()
  return normalizedProvider === 'qq'
    ? value.slice(separator + 1)
    : value.slice(0, separator)
}

// A request without a provider represents the complete parallel-account key.
// Provider-scoped requests compare only the corresponding side of that key.
export function isMusicAccountRequestCurrent(requestKey, currentKey, provider = '') {
  const normalizedProvider = String(provider || '').trim().toLowerCase()
  if (!normalizedProvider) return String(requestKey ?? '') === String(currentKey ?? '')

  const requestedId = getMusicAccountId(requestKey, normalizedProvider)
  const currentId = getMusicAccountId(currentKey, normalizedProvider)
  return Boolean(requestedId) && requestedId === currentId
}
