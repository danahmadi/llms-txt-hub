import { describe, expect, it } from 'vitest'
import config from '../apps/web/content-collections.ts'

describe('content schema security migration', () => {
  it('rejects oversized release highlights before collecting element errors', async () => {
    const collection = config.collections.find(item => item.name === 'ExtensionUpdate')
    if (!collection) throw new Error('ExtensionUpdate collection is missing')
    const result = await collection.schema['~standard'].validate({
      content: 'Release notes',
      version: '1.0.0',
      title: 'Release',
      description: 'Release fixture',
      date: '2026-10-26',
      highlights: Array(5000).fill(1)
    })
    expect(result.issues).toHaveLength(1)
    expect(result.issues?.[0].path).toEqual(['highlights'])
  })

  it('preserves stored URL bytes and the MDX body', async () => {
    const collection = config.collections.find(item => item.name === 'Website')
    if (!collection) throw new Error('Website collection is missing')
    const input = {
      content: '# Existing document\n',
      name: 'Existing website',
      description: 'Existing website fixture',
      website: 'https://example.com/ ',
      llmsUrl: 'https://example.com/llms.txt',
      llmsFullUrl: '',
      category: 'developer-tools',
      publishedAt: '2026-10-26'
    }
    const result = await collection.schema['~standard'].validate(input)
    expect(result.issues).toBeUndefined()
    expect(result.value).toMatchObject(input)
  })
})
