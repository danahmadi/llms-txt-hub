import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire, findPackageJSON } from 'node:module'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const webRequire = createRequire(new URL('../apps/web/package.json', import.meta.url))
const rootRequire = createRequire(new URL('../package.json', import.meta.url))
const flagsRequire = createRequire(new URL('../packages/flags/package.json', import.meta.url))
const contentRequire = createRequire(
  findPackageJSON('@content-collections/core', new URL('../apps/web/package.json', import.meta.url))
)
const contributorsRequire = createRequire(rootRequire.resolve('all-contributors-cli/package.json'))
const inquirerRequire = createRequire(contributorsRequire.resolve('inquirer'))
const editorRequire = createRequire(inquirerRequire.resolve('external-editor'))
const toolbarRequire = createRequire(webRequire.resolve('@vercel/toolbar/plugins/next'))
const routingRequire = createRequire(toolbarRequire.resolve('@vercel/microfrontends/config'))

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

test('microfrontend proxy cookie parser preserves overrides and rejects invalid serialization', () => {
  const cookie = routingRequire('cookie')
  assert.deepEqual(cookie.parse('__vercel_override=preview.example.test; encoded=a%20b'), {
    __vercel_override: 'preview.example.test',
    encoded: 'a b'
  })
  assert.deepEqual(cookie.parse('duplicate=first; duplicate=second'), { duplicate: 'first' })
  assert.equal(
    cookie.serialize('preview', 'example.test', { path: '/', httpOnly: true, secure: true }),
    'preview=example.test; Path=/; HttpOnly; Secure'
  )
  for (const args of [
    ['bad; injected=1', 'value'],
    ['preview', 'value', { path: '/; injected=1' }],
    ['preview', 'value', { domain: 'example.test; injected=1' }]
  ]) {
    assert.throws(() => cookie.serialize(...args), TypeError)
  }
})

test('flags discovery accepts access proofs and rejects override tokens', async () => {
  const { createAccessProof, encryptOverrides, verifyAccess } = flagsRequire('flags')
  const secret = Buffer.alloc(32, 7).toString('base64url')
  const proof = await createAccessProof(secret)
  const override = await encryptOverrides({ showValidator: true }, secret)
  assert.equal(await verifyAccess(`Bearer ${proof}`, secret), true)
  assert.equal(await verifyAccess(`Bearer ${override}`, secret), false)
  assert.equal(await verifyAccess('Bearer invalid', secret), false)
  assert.equal(await verifyAccess(null, secret), false)
  assert.equal(
    await verifyAccess(`Bearer ${proof}`, Buffer.alloc(32, 8).toString('base64url')),
    false
  )
})
