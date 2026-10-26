const endpoint = 'https://api.firecrawl.dev/v1/llmstxt'

interface GenerationResult {
  success: boolean
  error?: string
  status?: string
  data?: { llmstxt?: string; llmsfulltxt?: string }
}

/**
 * Checks whether a provider response can be inspected safely.
 * @param value Untrusted provider payload.
 * @returns Whether the payload has record properties.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Formats the provider's existing HTTP error contract.
 * @param status HTTP response status.
 * @param body Untrusted response body.
 * @param method Request method used by the legacy operation.
 * @returns Error with the previous operation message.
 */
function httpError(status: number, body: unknown, method: string): Error {
  const value = isRecord(body) ? body : {}
  const details = value.details ? ` - ${JSON.stringify(value.details)}` : ''
  if (method === 'POST' && (status < 200 || status >= 300)) {
    const message = `Request failed with status code ${status}`
    return new Error(value.error ? `${message}. Error: ${value.error} ${details}` : message)
  }
  if (method === 'GET' && status === 404) return new Error('LLMs.txt generation job not found')
  const action =
    method === 'POST' ? 'start LLMs.txt generation' : 'check LLMs.txt generation status'
  if ([400, 402, 403, 408, 409, 500].includes(status)) {
    return new Error(
      `Failed to ${action}. Status code: ${status}. Error: ${value.error || 'Unknown error occurred'}${details}`
    )
  }
  return new Error(`Unexpected error occurred while trying to ${action}. Status code: ${status}`)
}

/**
 * Makes one fixed-origin request without retries or credential-bearing redirects.
 * @param apiKey Existing provider credential.
 * @param method Request method.
 * @param url Fixed endpoint or its encoded job path.
 * @param body Optional job-start parameters.
 * @returns Parsed JSON or the provider's non-JSON text.
 */
async function request(apiKey: string, method: 'POST' | 'GET', url: string, body?: object) {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    redirect: 'error',
    ...(body ? { body: JSON.stringify(body) } : {})
  })
  // Axios returned non-JSON text unchanged; preserve the resulting failure behavior.
  const text = await response.text()
  let value: unknown = text
  try {
    value = JSON.parse(text)
  } catch {
    // The caller handles malformed provider payloads without writing output files.
  }
  if (response.status !== 200) throw httpError(response.status, value, method)
  return value
}

/**
 * Validates completed payloads before the caller writes either generated file.
 * @param value Provider completion payload.
 * @returns The completed operation and its unchanged output strings.
 */
function completedResult(value: Record<string, unknown>): GenerationResult {
  if (typeof value.success !== 'boolean' || !isRecord(value.data)) {
    throw new Error('Invalid LLMs.txt generation response')
  }
  const { llmstxt, llmsfulltxt } = value.data
  if (
    (llmstxt !== undefined && typeof llmstxt !== 'string') ||
    (llmsfulltxt !== undefined && typeof llmsfulltxt !== 'string')
  ) {
    throw new Error('Invalid LLMs.txt generation response')
  }
  return {
    ...value,
    success: value.success,
    status: 'completed',
    data: {
      ...value.data,
      ...(llmstxt !== undefined ? { llmstxt } : {}),
      ...(llmsfulltxt !== undefined ? { llmsfulltxt } : {})
    }
  }
}

/**
 * Preserves the generator's legacy Firecrawl operation without the SDK's Zod dependency.
 * The provider has deprecated this endpoint; no replacement workflow is introduced here.
 * @param apiKey Existing Firecrawl key selected by the CLI.
 * @param url Website to pass to the provider unchanged.
 * @param maxUrls Existing CLI limit to pass to the provider unchanged.
 * @returns Completed strings or the provider's operation failure.
 */
export async function generateLLMsText(
  apiKey: string,
  url: string,
  maxUrls: number
): Promise<GenerationResult> {
  const started = await request(apiKey, 'POST', endpoint, {
    url,
    maxUrls,
    showFullText: true,
    // Retain the attribution emitted by the previous SDK's immediate-construction call.
    origin: 'js-sdk@1.25.1'
  })
  if (!isRecord(started) || !started.success || 'error' in started) {
    return {
      success: false,
      error:
        isRecord(started) && typeof started.error === 'string' ? started.error : 'Unknown error'
    }
  }
  if (typeof started.id !== 'string' || !started.id || started.id === '.' || started.id === '..') {
    throw new Error('Failed to start LLMs.txt generation. No job ID returned.')
  }
  const statusUrl = `${endpoint}/${encodeURIComponent(started.id)}`
  while (true) {
    const status = await request(apiKey, 'GET', statusUrl)
    if (!isRecord(status)) throw new Error('Invalid LLMs.txt generation response')
    if ('error' in status && !status.success) {
      return {
        success: false,
        ...(typeof status.status === 'string' ? { status: status.status } : {}),
        error: typeof status.error === 'string' ? status.error : 'Unknown error'
      }
    }
    if (status.status === 'completed') return completedResult(status)
    if (status.status === 'failed') {
      throw new Error(`LLMs.txt generation job failed. Error: ${status.error}`)
    }
    if (status.status !== 'processing') {
      return { success: false, error: 'LLMs.txt generation job terminated unexpectedly' }
    }
    await new Promise(resolve => setTimeout(resolve, 2000))
  }
}
