import { createRequire } from 'node:module'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { getFlags } from '../packages/flags/access'

vi.mock('../packages/flags/index', () => ({
  showValidator: {
    key: 'showValidator',
    description: 'Validator fixture',
    options: [{ value: false, label: 'Off' }]
  }
}))

const flagsRequire = createRequire(new URL('../packages/flags/package.json', import.meta.url))
const webRequire = createRequire(new URL('../apps/web/package.json', import.meta.url))
const { createAccessProof, encryptOverrides } = flagsRequire('flags')
const { NextRequest } = webRequire('next/server')
const secret = Buffer.alloc(32, 7).toString('base64url')

describe('flag discovery authorization', () => {
  const originalSecret = process.env.FLAGS_SECRET

  beforeAll(() => {
    process.env.FLAGS_SECRET = secret
  })

  afterAll(() => {
    if (originalSecret === undefined) {
      Reflect.deleteProperty(process.env, 'FLAGS_SECRET')
    } else {
      process.env.FLAGS_SECRET = originalSecret
    }
  })

  it('returns definitions for an access proof', async () => {
    const proof = await createAccessProof(secret)
    const request = new NextRequest('http://localhost/.well-known/vercel/flags', {
      headers: { Authorization: `Bearer ${proof}` }
    })
    const response = await getFlags(request)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      definitions: {
        showValidator: {
          description: 'Validator fixture',
          options: [{ value: false, label: 'Off' }]
        }
      }
    })
  })

  it('rejects a flag override token instead of disclosing definitions', async () => {
    const override = await encryptOverrides({ showValidator: true }, secret)
    const request = new NextRequest('http://localhost/.well-known/vercel/flags', {
      headers: { Authorization: `Bearer ${override}` }
    })
    const response = await getFlags(request)
    expect(response.status).toBe(401)
    expect(await response.json()).toBeNull()
  })

  it.each([undefined, 'Bearer invalid'])(
    'rejects missing or invalid authorization: %s',
    async value => {
      const request = new NextRequest('http://localhost/.well-known/vercel/flags', {
        headers: value ? { Authorization: value } : {}
      })
      const response = await getFlags(request)
      expect(response.status).toBe(401)
      expect(await response.json()).toBeNull()
    }
  )
})
