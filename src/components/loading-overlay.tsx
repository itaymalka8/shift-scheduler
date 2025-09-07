'use client'

import { useLoadingStore } from '@/store/loading-store'

export function LoadingOverlay() {
  const { isLoading } = useLoadingStore()

  if (!isLoading) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex flex-col items-center justify-center z-[100] text-white">
      <div className="loader"></div>
      <p className="mt-4 text-lg">מעבד בקשה, אנא המתן...</p>
    </div>
  )
}

