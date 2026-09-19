import { access } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    if (!specifier.startsWith('.') || !context.parentURL) throw error
    for (const extension of ['.js', '.mjs']) {
      const candidate = new URL(`${specifier}${extension}`, context.parentURL)
      try {
        await access(fileURLToPath(candidate))
        return { url: pathToFileURL(fileURLToPath(candidate)).href, shortCircuit: true }
      } catch {}
    }
    throw error
  }
}
