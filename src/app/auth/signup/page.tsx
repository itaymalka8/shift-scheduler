'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/auth-store'

export default function SignUp() {
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    confirmPassword: '',
    email: '',
    name: ''
  })
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()
  const { register } = useAuthStore()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')
    
    // בדיקות ולידציה
    if (formData.password !== formData.confirmPassword) {
      setError('הסיסמאות אינן תואמות')
      setIsLoading(false)
      return
    }
    
    // הסרת תנאי אורך הסיסמה - כל סיסמה תקינה
    
    if (!formData.email.includes('@')) {
      setError('כתובת מייל לא תקינה')
      setIsLoading(false)
      return
    }
    
    try {
      const success = await register({
        username: formData.username,
        password: formData.password,
        email: formData.email,
        name: formData.name,
        role: 'user', // משתמש חדש מתחיל כמשתמש רגיל
        permissions: [
          'schedule_view',
          'employees_view',
          'vehicles_view',
          'requests_view',
          'workplan_view'
        ],
        isActive: true
      })
      
      if (success) {
        router.push('/auth/signin?message=registration-success')
      } else {
        setError('שם משתמש או מייל כבר קיימים במערכת')
      }
    } catch (error) {
      setError('שגיאה ברישום. אנא נסה שוב.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    })
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
          <div className="w-20 h-20 bg-gradient-to-br from-green-600 to-teal-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <i className="fas fa-user-plus text-white text-2xl"></i>
          </div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">
            רישום למערכת
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
            <label htmlFor="name" className="block text-sm font-medium text-slate-700 mb-2">
              שם מלא
            </label>
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleInputChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="הקלד שם מלא"
              required
            />
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-2">
              כתובת מייל
            </label>
            <input
              type="email"
              id="email"
              name="email"
              value={formData.email}
              onChange={handleInputChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="הקלד כתובת מייל"
              required
            />
          </div>

          <div>
            <label htmlFor="username" className="block text-sm font-medium text-slate-700 mb-2">
              שם משתמש
            </label>
            <input
              type="text"
              id="username"
              name="username"
              value={formData.username}
              onChange={handleInputChange}
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
              name="password"
              value={formData.password}
              onChange={handleInputChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent [&::-ms-reveal]:text-gray-700 [&::-webkit-textfield-decoration-container]:text-gray-700 [&::-ms-clear]:text-gray-700"
              placeholder="הקלד סיסמה"
              required
            />
          </div>

          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-slate-700 mb-2">
              אישור סיסמה
            </label>
            <input
              type="password"
              id="confirmPassword"
              name="confirmPassword"
              value={formData.confirmPassword}
              onChange={handleInputChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent [&::-ms-reveal]:text-gray-700 [&::-webkit-textfield-decoration-container]:text-gray-700 [&::-ms-clear]:text-gray-700"
              placeholder="הקלד שוב את הסיסמה"
              required
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-green-600 hover:bg-green-700 text-white py-2 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            ) : (
              <i className="fas fa-user-plus"></i>
            )}
            {isLoading ? 'נרשם...' : 'הירשם למערכת'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-sm text-slate-600">
            כבר יש לך חשבון?{' '}
            <a 
              href="/auth/signin" 
              className="text-blue-600 hover:text-blue-800 font-medium"
            >
              התחבר כאן
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
