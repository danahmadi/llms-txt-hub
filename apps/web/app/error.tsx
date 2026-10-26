'use client'

import { Button } from '@thedaviddias/design-system/button'
import { logger } from '@thedaviddias/logging'
import type { ErrorInfo } from 'next/error'
import { useEffect } from 'react'

/**
 * Render a safe fallback and retry through the Next.js error boundary.
 * @param props - The thrown value and framework recovery callbacks.
 * @returns The error page with a retry action.
 */
// biome-ignore lint/suspicious/noShadowRestrictedNames: Next.js requires this component to be named Error
export default function Error({ error, retry }: ErrorInfo) {
  useEffect(() => {
    logger.error(
      error instanceof globalThis.Error || typeof error === 'string'
        ? error
        : 'An unexpected application error occurred'
    )
  }, [error])

  return (
    <main className="container relative mx-auto flex flex-col items-center justify-center px-4">
      <div className="mx-auto flex h-screen flex-col items-center justify-center">
        <div className="flex h-full flex-col items-center justify-center">
          <span className="not-found rounded-md px-3.5 py-1 text-sm font-medium dark:text-neutral-50">
            Error
          </span>
          <h1 className="mt-5 text-3xl font-bold dark:text-neutral-50 md:text-5xl">
            Something went wrong!
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-center text-base font-medium text-neutral-400">
            An unexpected error occurred. Please try again later.
          </p>
          <Button onClick={() => retry()} className="mt-8">
            Try again
          </Button>
        </div>
      </div>
    </main>
  )
}
