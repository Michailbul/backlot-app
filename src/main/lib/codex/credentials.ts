import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { app, safeStorage } from "electron"

const CODEX_API_KEY_FILE = "codex-api-key.dat"

function getCodexApiKeyPath(): string {
  return join(app.getPath("userData"), CODEX_API_KEY_FILE)
}

function getFallbackPath(): string {
  return `${getCodexApiKeyPath()}.json`
}

function normalizeCodexApiKeyValue(apiKey: string | null | undefined): string | null {
  const trimmed = apiKey?.trim()
  if (!trimmed || !trimmed.startsWith("sk-")) {
    return null
  }
  return trimmed
}

export function loadStoredCodexApiKey(): string | null {
  const encryptedPath = getCodexApiKeyPath()
  const fallbackPath = getFallbackPath()

  try {
    if (existsSync(encryptedPath) && safeStorage.isEncryptionAvailable()) {
      const decrypted = safeStorage.decryptString(readFileSync(encryptedPath))
      return normalizeCodexApiKeyValue(decrypted)
    }

    if (existsSync(fallbackPath)) {
      const raw = readFileSync(fallbackPath, "utf8")
      const parsed = JSON.parse(raw) as { apiKey?: string }
      const apiKey = normalizeCodexApiKeyValue(parsed.apiKey)
      if (apiKey && safeStorage.isEncryptionAvailable()) {
        saveStoredCodexApiKey(apiKey)
        unlinkSync(fallbackPath)
      }
      return apiKey
    }
  } catch (error) {
    console.error("[codex] Failed to load stored Codex API key:", error)
  }

  return null
}

export function saveStoredCodexApiKey(apiKey: string): void {
  const normalized = normalizeCodexApiKeyValue(apiKey)
  if (!normalized) {
    throw new Error("Invalid Codex API key format. Key should start with 'sk-'")
  }

  const encryptedPath = getCodexApiKeyPath()
  mkdirSync(dirname(encryptedPath), { recursive: true })

  if (safeStorage.isEncryptionAvailable()) {
    writeFileSync(encryptedPath, safeStorage.encryptString(normalized))
    if (existsSync(getFallbackPath())) {
      unlinkSync(getFallbackPath())
    }
    return
  }

  console.warn("[codex] safeStorage unavailable; storing Codex API key without OS encryption")
  writeFileSync(getFallbackPath(), JSON.stringify({ apiKey: normalized }), "utf8")
}

export function clearStoredCodexApiKey(): void {
  for (const path of [getCodexApiKeyPath(), getFallbackPath()]) {
    try {
      if (existsSync(path)) {
        unlinkSync(path)
      }
    } catch (error) {
      console.error("[codex] Failed to clear stored Codex API key:", error)
    }
  }
}

export function hasStoredCodexApiKey(): boolean {
  return Boolean(loadStoredCodexApiKey())
}

export function isCodexApiKeyEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}
