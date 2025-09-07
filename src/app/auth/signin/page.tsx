'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/auth-store'

export default function SignIn() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(false)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()
  const { login, isAuthenticated, initializeUsers } = useAuthStore()

  useEffect(() => {
    // אתחול משתמשים ברירת מחדל
    initializeUsers()
    
    // טעינת פרטי התחברות שמורים
    const savedUsername = localStorage.getItem('rememberedUsername')
    const savedPassword = localStorage.getItem('rememberedPassword')
    if (savedUsername && savedPassword) {
      setUsername(savedUsername)
      setPassword(savedPassword)
      setRememberMe(true)
    }
    
    // בדיקה אם המשתמש כבר מחובר
    if (isAuthenticated) {
      router.push('/schedule')
    }
  }, [isAuthenticated, router, initializeUsers])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')
    
    try {
      const success = await login(username, password)
      
      if (success) {
        // שמירת פרטי התחברות אם "זכור אותי" מסומן
        if (rememberMe) {
          localStorage.setItem('rememberedUsername', username)
          localStorage.setItem('rememberedPassword', password)
        } else {
          localStorage.removeItem('rememberedUsername')
          localStorage.removeItem('rememberedPassword')
        }
        
        router.push('/schedule')
      } else {
        setError('שם משתמש או סיסמה שגויים')
      }
    } catch (error) {
      setError('שגיאה בהתחברות. אנא נסה שוב.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center">
      <style jsx>{`
        input[type="password"]::-ms-reveal {
          color: #374151 !important;
          background-color: transparent !important;
        }
        input[type="password"]::-webkit-textfield-decoration-container {
          color: #374151 !important;
          background-color: transparent !important;
        }
        input[type="password"]::-ms-clear {
          color: #374151 !important;
          background-color: transparent !important;
        }
        @media (max-width: 768px) {
          input[type="password"]::-webkit-textfield-decoration-container {
            color: #374151 !important;
            background-color: transparent !important;
            opacity: 1 !important;
          }
        }
      `}</style>
      <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-2xl p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-gradient-to-br from-blue-600 to-teal-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <i className="fas fa-shield-alt text-white text-2xl"></i>
          </div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">
            מערכת ניהול משמרות
          </h1>
          <p className="text-slate-600">
            מודיעין בילוש שפט
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="username" className="block text-sm font-medium text-slate-700 mb-2">
              שם משתמש
            </label>
            <input
              type="text"
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="הקלד שם משתמש"
              required
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-2">
              סיסמה
            </label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent [&::-ms-reveal]:text-gray-700 [&::-webkit-textfield-decoration-container]:text-gray-700 [&::-ms-clear]:text-gray-700"
              placeholder="הקלד סיסמה"
              required
            />
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="rememberMe"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label htmlFor="rememberMe" className="mr-2 block text-sm text-slate-700">
              זכור אותי
            </label>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            ) : (
              <i className="fas fa-sign-in-alt"></i>
            )}
            {isLoading ? 'מתחבר...' : 'התחבר'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-sm text-slate-600">
            אין לך חשבון?{' '}
            <a 
              href="/auth/signup" 
              className="text-blue-600 hover:text-blue-800 font-medium"
            >
              הירשם כאן
            </a>
          </p>
        </div>

        <div className="mt-6 text-center">
          <p className="text-xs text-slate-500">
            © 2024 כל הזכויות שמורות לאיתי מלכא
          </p>
        </div>
      </div>
    </div>
  )
}