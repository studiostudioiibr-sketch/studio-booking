'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { trackMetaEvent } from '@/lib/meta/browser'

export function MetaPageViewTracker() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const mountedRef = useRef(false)

  useEffect(() => {
    // The base snippet already tracks initial PageView.
    if (!mountedRef.current) {
      mountedRef.current = true
      return
    }
    const queryString = searchParams.toString()
    trackMetaEvent({
      eventName: 'PageView',
      parameters: {
        page_path: queryString ? `${pathname}?${queryString}` : pathname,
      },
      dedupe: false,
    })
  }, [pathname, searchParams])

  return null
}
