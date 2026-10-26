import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateLLMsText } from '../packages/generator/src/firecrawl-llmstxt'
import contracts from './fixtures/firecrawl-llmstxt-contract.json'

const endpoint = 'https://api.firecrawl.dev/v1/llmstxt'
const complete = {
  success: true,
  status: 'completed',
  data: { llmstxt: '# Summary\n☀️', llmsfulltxt: '# Full\n' }
}
const started = { success: true, id: 'fixture-job' }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('legacy Firecrawl operation without its SDK', () => {
  it.each(contracts)('matches the captured SDK contract: $name', async fixture => {
    vi.useFakeTimers()
    const calls: object[] = []
    let index = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, options: RequestInit) => {
        expect(new URL(url).origin).toBe('https://api.firecrawl.dev')
        expect(options.redirect).toBe('error')
        expect(options.signal).toBeUndefined()
        calls.push({
          method: options.method,
          url,
          ...(options.body ? { body: JSON.parse(String(options.body)) } : {}),
          headers: options.headers
        })
        const reply = fixture.replies[index++]
        if (!reply) throw new Error('Unexpected extra request')
        if ('networkError' in reply) throw new Error(reply.networkError)
        return new Response('raw' in reply ? String(reply.body) : JSON.stringify(reply.body), {
          status: reply.status
        })
      })
    )
    const outcome = generateLLMsText('fixture-only', 'https://example.com', 50).then(
      result => ({ result }),
      error => ({ error: error.message })
    )
    await vi.runAllTimersAsync()
    // The SDK leaked a JavaScript TypeError for non-JSON success bodies. Both paths fail,
    // but the adapter returns the existing operation failure instead of that internal error.
    const expected =
      fixture.name === 'invalid POST JSON'
        ? { result: { success: false, error: 'Unknown error' } }
        : fixture.expected
    expect(await outcome).toEqual(expected)
    expect(calls).toEqual(fixture.calls)
    expect(calls.filter(call => 'method' in call && call.method === 'POST')).toHaveLength(1)
  })

  it.each([
    null,
    [],
    { success: true, status: 'completed' },
    { success: true, status: 'completed', data: null },
    { success: true, status: 'completed', data: { llmstxt: 42 } },
    { success: true, status: 'completed', data: { llmstxt: 'summary', llmsfulltxt: {} } },
    { success: 'yes', status: 'completed', data: {} }
  ])('rejects malformed completed/status payloads before files can be written: %j', async body => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(started))
      .mockResolvedValueOnce(Response.json(body))
    vi.stubGlobal('fetch', fetch)
    await expect(generateLLMsText('fixture-only', 'https://example.com', 50)).rejects.toThrow(
      'Invalid LLMs.txt generation response'
    )
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it.each(['', '.', '..', 42, {}])('rejects unusable job IDs without a GET: %j', async id => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ success: true, id }))
    vi.stubGlobal('fetch', fetch)
    await expect(generateLLMsText('fixture-only', 'https://example.com', 50)).rejects.toThrow(
      'No job ID returned'
    )
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('encodes a provider ID as one path segment and never sends credentials to another origin', async () => {
    const id = '//attacker.invalid/path?token=1#fragment'
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ success: true, id }))
      .mockResolvedValueOnce(Response.json(complete))
    vi.stubGlobal('fetch', fetch)
    await generateLLMsText('fixture-only', 'https://example.com', 7)
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      endpoint,
      `${endpoint}/${encodeURIComponent(id)}`
    ])
    for (const [url, options] of fetch.mock.calls) {
      expect(new URL(url).origin).toBe('https://api.firecrawl.dev')
      expect(options.headers.Authorization).toBe('Bearer fixture-only')
      expect(options.redirect).toBe('error')
    }
  })

  it('fails a redirect without retrying the billed POST', async () => {
    const fetch = vi.fn(async (_url, options) => {
      expect(options.redirect).toBe('error')
      throw new TypeError('fetch failed: unexpected redirect')
    })
    vi.stubGlobal('fetch', fetch)
    await expect(generateLLMsText('fixture-only', 'https://example.com', 50)).rejects.toThrow(
      'unexpected redirect'
    )
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('keeps the two-second processing interval without starting another job', async () => {
    vi.useFakeTimers()
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(started))
      .mockResolvedValueOnce(Response.json({ success: true, status: 'processing' }))
      .mockResolvedValueOnce(Response.json(complete))
    vi.stubGlobal('fetch', fetch)
    const result = generateLLMsText('fixture-only', 'https://example.com', 50)
    await vi.advanceTimersByTimeAsync(1999)
    expect(fetch).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(await result).toEqual(complete)
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(fetch.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1)
  })

  it('retains a completed failure result instead of treating it as success', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json(started))
        .mockResolvedValueOnce(Response.json({ ...complete, success: false }))
    )
    expect(await generateLLMsText('fixture-only', 'https://example.com', 50)).toEqual({
      ...complete,
      success: false
    })
  })

  it.each([false, true])(
    'runs the real CLI offline and preserves output/failed-write behavior (failure=%s)',
    failure => {
      const directory = mkdtempSync(join(tmpdir(), 'llms-generator-contract-'))
      const generatorManifest = fileURLToPath(
        new URL('../packages/generator/package.json', import.meta.url)
      )
      const generatorRequire = createRequire(generatorManifest)
      const entry = fileURLToPath(new URL('../packages/generator/src/index.ts', import.meta.url))
      try {
        writeFileSync(
          join(directory, 'package.json'),
          JSON.stringify({ name: 'llms-txt-hub', type: 'module' })
        )
        writeFileSync(
          join(directory, 'offline.mjs'),
          `
        import assert from 'node:assert/strict';
        import { createRequire } from 'node:module';
        import { pathToFileURL } from 'node:url';
        const require = createRequire(${JSON.stringify(generatorManifest)});
        const manifest = require('inquirer/package.json');
        const { default: inquirer } = await import(new URL(manifest.module, pathToFileURL(require.resolve('inquirer/package.json'))).href);
        inquirer.prompt = async () => ({ choice: 'fixture' });
        let calls = 0;
        globalThis.fetch = async (url, options) => {
          assert.equal(new URL(url).origin, 'https://api.firecrawl.dev');
          assert.equal(options.headers.Authorization, 'Bearer fixture-only');
          assert.equal(options.redirect, 'error');
          if (calls++ === 0) {
            assert.equal(options.method, 'POST');
            assert.deepEqual(JSON.parse(options.body), { url: 'https://example.org/docs', maxUrls: 7, showFullText: true, origin: 'js-sdk@1.25.1' });
            return Response.json({ success: true, id: 'fixture-job' });
          }
          assert.equal(calls, 2);
          assert.equal(options.method, 'GET');
          return Response.json(${JSON.stringify(failure ? { success: true, status: 'completed', data: { llmstxt: 42 } } : complete)});
        };
        process.on('exit', () => assert.equal(calls, 2));
      `
        )
        const result = spawnSync(
          process.execPath,
          [
            '--import',
            generatorRequire.resolve('tsx'),
            '--import',
            join(directory, 'offline.mjs'),
            entry,
            '--api-key',
            'fixture-only',
            '--url',
            'https://example.org/docs',
            '--max-urls',
            '7'
          ],
          {
            cwd: directory,
            env: { PATH: process.env.PATH, NEXT_TELEMETRY_DISABLED: '1' },
            encoding: 'utf8'
          }
        )
        expect(result.status, result.stderr).toBe(failure ? 1 : 0)
        const output = join(directory, 'content/unofficial/fixture')
        if (failure) {
          expect(existsSync(output)).toBe(false)
        } else {
          expect(readFileSync(join(output, 'llms.txt'), 'utf8')).toBe(complete.data.llmstxt)
          expect(readFileSync(join(output, 'llms-full.txt'), 'utf8')).toBe(
            complete.data.llmsfulltxt
          )
        }
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    }
  )
})
