'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/auth-store'

export default function Home() {
  const router = useRouter()
  const { isAuthenticated, initializeUsers } = useAuthStore()
  const [isLoading, setIsLoading] = useState(true)
  const [showWelcome, setShowWelcome] = useState(false)

  useEffect(() => {
    // אתחול משתמשים ברירת מחדל
    initializeUsers()
    
    // הצגת מסך הכניסה למשך 2 שניות
    const timer = setTimeout(() => {
      setIsLoading(false)
      setShowWelcome(true)
    }, 2000)

    return () => clearTimeout(timer)
  }, [initializeUsers])

  // תמיד הצג את מסך הכניסה האינטראקטיבי
  if (!showWelcome) {
    return (
      <div className="w-screen h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-blue-900 flex items-center justify-center relative overflow-hidden">
        {/* רקע אנימציה */}
        <div className="absolute inset-0 bg-gradient-to-r from-blue-900/50 to-blue-800/50"></div>
        
        {/* חלקיקים נעים */}
        <div className="absolute inset-0">
          {[...Array(20)].map((_, i) => (
            <div
              key={i}
              className="absolute w-2 h-2 bg-white/20 rounded-full animate-pulse"
              style={{
                left: `${Math.random() * 100}%`,
                top: `${Math.random() * 100}%`,
                animationDelay: `${Math.random() * 2}s`,
                animationDuration: `${2 + Math.random() * 2}s`
              }}
            />
          ))}
        </div>

        <div className="text-center relative z-10">
          {/* ספינר טעינה */}
          <div className="w-24 h-24 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto mb-8"></div>
          
          {/* כותרת האפליקציה */}
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-6 animate-fade-in-up">
            סידור עבודה מודיעין בילוש שפט
          </h1>
          
          {/* טקסט טעינה */}
          <p className="text-white/80 text-lg animate-pulse">
            טוען את המערכת...
          </p>
        </div>
      </div>
    )
  }

  const handleEnterApp = () => {
    if (isAuthenticated) {
      router.push('/schedule')
    } else {
      router.push('/auth/signin')
    }
  }


  // מסך כניסה אינטראקטיבי
  return (
    <div className="w-screen h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-blue-900 flex items-center justify-center relative overflow-hidden">
      {/* רקע אנימציה */}
      <div className="absolute inset-0 bg-gradient-to-r from-blue-900/50 to-blue-800/50"></div>
      
      {/* חלקיקים נעים */}
      <div className="absolute inset-0">
        {[...Array(30)].map((_, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 bg-white/30 rounded-full animate-pulse"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 3}s`,
              animationDuration: `${3 + Math.random() * 2}s`
            }}
          />
        ))}
      </div>

      {/* תוכן ראשי */}
      <div className="text-center relative z-10 max-w-4xl mx-auto px-6">
        {/* כותרת ראשית */}
        <div className={`mb-12 transition-all duration-1000 ${showWelcome ? 'opacity-100 transform translate-y-0' : 'opacity-0 transform translate-y-8'}`}>
          <h1 className="welcome-title text-5xl md:text-6xl lg:text-7xl font-bold text-white mb-6 leading-tight text-glow animate-fade-in-up">
            ברוכים הבאים
          </h1>
          <h2 className="welcome-subtitle text-3xl md:text-4xl lg:text-5xl font-semibold text-white/90 mb-8 leading-tight text-shadow animate-fade-in-down">
            לסידור עבודה מודיעין בילוש שפט
          </h2>
        </div>

        {/* תיאור המערכת */}
        <div className={`mb-12 transition-all duration-1000 delay-300 ${showWelcome ? 'opacity-100 transform translate-y-0' : 'opacity-0 transform translate-y-8'}`}>
          <p className="text-xl md:text-2xl text-white/80 mb-6 leading-relaxed">
            מערכת ניהול משמרות מתקדמת וחכמה
          </p>
          <p className="text-lg md:text-xl text-white/70 leading-relaxed">
            לניהול יעיל של סידור עבודה, משמרות ועובדים
          </p>
        </div>

        {/* כפתור כניסה */}
        <div className={`mb-16 transition-all duration-1000 delay-500 ${showWelcome ? 'opacity-100 transform translate-y-0' : 'opacity-0 transform translate-y-8'}`}>
          <button
            onClick={handleEnterApp}
            className="welcome-button bg-white text-blue-900 px-12 py-6 rounded-2xl text-2xl font-bold shadow-2xl hover:bg-blue-50 transition-all duration-300 text-shadow"
          >
            <i className="fas fa-sign-in-alt ml-3 animate-float"></i>
            כניסה למערכת
          </button>
        </div>

        {/* תכונות המערכת */}
        <div className={`grid grid-cols-1 md:grid-cols-3 gap-8 mb-16 transition-all duration-1000 delay-700 ${showWelcome ? 'opacity-100 transform translate-y-0' : 'opacity-0 transform translate-y-8'}`}>
          <div className="feature-card bg-white/10 backdrop-blur-sm rounded-2xl p-6 border border-white/20 hover:bg-white/20 transition-all duration-300">
            <i className="fas fa-calendar-alt text-4xl text-white mb-4 animate-glow"></i>
            <h3 className="text-xl font-bold text-white mb-2 text-glow">ניהול משמרות</h3>
            <p className="text-white/80">סידור עבודה חכם ויעיל</p>
          </div>
          
          <div className="feature-card bg-white/10 backdrop-blur-sm rounded-2xl p-6 border border-white/20 hover:bg-white/20 transition-all duration-300">
            <i className="fas fa-users text-4xl text-white mb-4 animate-glow"></i>
            <h3 className="text-xl font-bold text-white mb-2 text-glow">ניהול עובדים</h3>
            <p className="text-white/80">מעקב אחר עובדים ומשמרות</p>
          </div>
          
          <div className="feature-card bg-white/10 backdrop-blur-sm rounded-2xl p-6 border border-white/20 hover:bg-white/20 transition-all duration-300">
            <i className="fas fa-chart-line text-4xl text-white mb-4 animate-glow"></i>
            <h3 className="text-xl font-bold text-white mb-2 text-glow">דוחות וניתוח</h3>
            <p className="text-white/80">מעקב וניתוח ביצועים</p>
          </div>
        </div>

        {/* זכויות יוצרים */}
        <div className={`transition-all duration-1000 delay-1000 ${showWelcome ? 'opacity-100 transform translate-y-0' : 'opacity-0 transform translate-y-8'}`}>
          <div className="border-t border-white/20 pt-8">
            <p className="text-white/60 text-lg">
              © 2024 כל הזכויות שמורות לאיתי מלכא
            </p>
            <p className="text-white/50 text-sm mt-2">
              מערכת ניהול משמרות מתקדמת
            </p>
          </div>
        </div>
      </div>

      {/* אפקטים ויזואליים נוספים */}
      <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-white/5 rounded-full blur-3xl animate-pulse"></div>
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-white/5 rounded-full blur-3xl animate-pulse" style={{animationDelay: '1s'}}></div>
    </div>
  )
}
