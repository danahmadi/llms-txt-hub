import { subscribeSchema } from '@thedaviddias/newsletter'
import {
  step1Schema,
  step2Schema,
  submitActionSchema
} from '@/components/forms/submit-form-schemas'

const submission = {
  category: 'developer-tools',
  description: 'Helpful documentation and tools for software developers.',
  name: 'Example',
  website: 'https://example.com',
  llmsUrl: 'https://example.com/llms.txt',
  llmsFullUrl: '',
  publishedAt: '2026-10-26'
}

describe('patched runtime schemas', () => {
  it('preserves valid submission data and newsletter groups', () => {
    expect(submitActionSchema.parse(submission)).toEqual(submission)
    expect(subscribeSchema.parse({ email: 'reader@example.com', groups: ['one'] })).toEqual({
      email: 'reader@example.com',
      groups: ['one']
    })
  })

  it('preserves custom category and URL errors', () => {
    const category = step2Schema.safeParse({ ...submission, category: 'invalid' })
    expect(category.success).toBe(false)
    if (!category.success) {
      expect(category.error.issues[0].message).toBe('Please select a valid category')
    }
    const website = step1Schema.safeParse({ website: 'invalid' })
    expect(website.success).toBe(false)
    if (!website.success) {
      expect(website.error.issues[0].message).toBe('Please enter a valid URL.')
    }
  })

  it('continues rejecting invalid dates and newsletter group values', () => {
    expect(submitActionSchema.safeParse({ ...submission, publishedAt: '2026-02-30' }).success).toBe(
      false
    )
    expect(subscribeSchema.safeParse({ email: 'reader@example.com', groups: [1] }).success).toBe(
      false
    )
  })
})
