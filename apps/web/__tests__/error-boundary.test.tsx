import { fireEvent, render, screen } from '@testing-library/react'
import { logger } from '@thedaviddias/logging'
import ErrorBoundary from '@/app/error'

jest.mock('@thedaviddias/logging', () => ({
  logger: { error: jest.fn() }
}))

describe('Next.js error boundary recovery', () => {
  beforeEach(() => jest.clearAllMocks())

  it('uses the framework retry callback without resetting only local state', () => {
    const retry = jest.fn()
    const reset = jest.fn()
    const error = new Error('Test failure')

    render(<ErrorBoundary error={error} retry={retry} reset={reset} />)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(retry).toHaveBeenCalledTimes(1)
    expect(reset).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledWith(error)
  })

  it('handles unknown thrown values without logging arbitrary object content', () => {
    render(<ErrorBoundary error={{ privateData: 'value' }} retry={jest.fn()} reset={jest.fn()} />)

    expect(logger.error).toHaveBeenCalledWith('An unexpected application error occurred')
    expect(screen.getByText('Something went wrong!')).toBeInTheDocument()
  })
})
