import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const contentRequire = createRequire(import.meta.resolve('@content-collections/core'))
const editorRequire = createRequire(import.meta.resolve('external-editor'))
const routingRequire = createRequire(import.meta.resolve('@vercel/microfrontends/config'))

test('content serializer preserves the supported collection values and options', () => {
  const serialize = contentRequire('serialize-javascript')
  const value = [
    {
      title: 'Guide',
      count: 42n,
      date: new Date('2026-01-01'),
      values: new Set(['a']),
      mapping: new Map([['key', 'value']])
    }
  ]
  const output = serialize(value, { space: 2, unsafe: true, ignoreFunction: true })
  const result = runInNewContext(`(${output})`)
  assert.equal(result[0].title, 'Guide')
  assert.equal(result[0].count, 42n)
  assert.equal(result[0].date.toISOString(), '2026-01-01T00:00:00.000Z')
  assert.equal(result[0].values.has('a'), true)
  assert.equal(result[0].mapping.get('key'), 'value')
})

test('content serializer does not execute spoofed RegExp flag content', () => {
  const serialize = contentRequire('serialize-javascript')
  const value = Object.create(RegExp.prototype)
  Object.defineProperty(value, 'source', { get: () => 'x' })
  Object.defineProperty(value, 'flags', { get: () => '"+(globalThis.compromised=true)+"' })
  value.toJSON = () => '@placeholder'
  const context = {}
  try {
    runInNewContext(
      `(${serialize({ value }, { space: 2, unsafe: true, ignoreFunction: true })})`,
      context
    )
  } catch (error) {
    assert.match(error.name, /^(SyntaxError|TypeError)$/)
  }
  assert.equal(context.compromised, undefined)
})

test('external editor creates and cleans up a temporary input without launching an editor', () => {
  const { ExternalEditor } = editorRequire('external-editor')
  const editor = new ExternalEditor('security compatibility fixture', { prefix: 'llms-security-' })
  try {
    assert.equal(readFileSync(editor.tempFile, 'utf8'), 'security compatibility fixture')
    assert.equal(editor.text, 'security compatibility fixture')
  } finally {
    editor.cleanup()
  }
})

test('microfrontend matcher retains parameter parsing and matching contracts', () => {
  const { pathToRegexp, parse } = routingRequire('path-to-regexp')
  const keys = []
  const matcher = pathToRegexp('/websites/:slug/:path*', keys)
  assert.equal(matcher.test('/websites/example-llms-txt/docs/start'), true)
  assert.equal(matcher.test('/settings/account'), false)
  assert.deepEqual(
    keys.map(key => key.name),
    ['slug', 'path']
  )
  assert.equal(parse('/websites/:slug')[1].name, 'slug')
})
