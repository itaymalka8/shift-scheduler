'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/auth-store'

export default function Home() {
  const router = useRouter()
  const { isAuthenticated, initializeUsers } = useAuthStore()

  useEffect(() => {
    // אתחול משתמשים ברירת מחדל
    initializeUsers()
    
    if (isAuthenticated) {
      // המשתמש מחובר - הפנה לסידור עבודה
      router.push('/schedule')
    } else {
      // המשתמש לא מחובר - הפנה להתחברות
      router.push('/auth/signin')
    }
  }, [isAuthenticated, router, initializeUsers])

  // מסך טעינה
  return (
    <div className="w-screen h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center">
      <div className="text-center">
        {/* ספינר טעינה */}
        <div className="w-20 h-20 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-8"></div>
        
        {/* כותרת האפליקציה */}
        <h1 className="text-3xl md:text-4xl font-bold text-white mb-4">
          סידור עבודה מודיעין בילוש שפט
        </h1>
        
        {/* זכויות יוצרים */}
        <p className="text-slate-300 text-sm">
          © 2024 כל הזכויות שמורות לאיתי מלכא
        </p>
      </div>
    </div>
  )
}
