import { type ApiData, verifyAccess } from 'flags'
import { type NextRequest, NextResponse } from 'next/server'
import * as flags from './index'

/**
 * Return feature flag definitions only to callers with a valid access proof.
 * @param request - The discovery request containing its authorization header.
 * @returns The private flag definitions or an unauthorized response.
 */
export const getFlags = async (request: NextRequest) => {
  const access = await verifyAccess(request.headers.get('Authorization'))

  if (!access) {
    return NextResponse.json(null, { status: 401 })
  }

  const definitions = Object.fromEntries(
    Object.values(flags).map(flag => [
      flag.key,
      {
        origin: flag.origin,
        description: flag.description,
        options: flag.options
      }
    ])
  )

  return NextResponse.json<ApiData>({
    definitions
  })
}
