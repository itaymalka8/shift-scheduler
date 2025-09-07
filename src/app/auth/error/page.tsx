'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export default function AuthError() {
  const router = useRouter()

  useEffect(() => {
    // חזרה לדף ההתחברות אחרי 5 שניות
    const timer = setTimeout(() => {
      router.push('/auth/signin')
    }, 5000)

    return () => clearTimeout(timer)
  }, [router])

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center">
      <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-2xl p-8 w-full max-w-md text-center">
        <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <i className="fas fa-exclamation-triangle text-red-600 text-2xl"></i>
        </div>
        
        <h1 className="text-2xl font-bold text-slate-800 mb-4">
          שגיאה בהתחברות
        </h1>
        
        <p className="text-slate-600 mb-6">
          לא ניתן להתחבר למערכת. אנא בדוק את ההרשאות שלך ונסה שוב.
        </p>
        
        <button
          onClick={() => router.push('/auth/signin')}
          className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg transition-colors"
        >
          חזרה להתחברות
        </button>
        
        <div className="mt-6 text-center">
          <p className="text-xs text-slate-500">
            © 2024 כל הזכויות שמורות לאיתי מלכא
          </p>
        </div>
      </div>
    </div>
  )
}

