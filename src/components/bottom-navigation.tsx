'use client'

import { useAuthStore } from '@/store/auth-store'

import { useState } from 'react'
import { useModalStore } from '@/store/modal-store'
import { useScheduleStore } from '@/store/schedule-store'

export function BottomNavigation() {
  const { openModal } = useModalStore()
  const { currentWeekOffset, changeWeek } = useScheduleStore()
  const { canManageUsers } = useAuthStore()
  const [activeTab, setActiveTab] = useState('schedule')

  const handleTabClick = (tab: string) => {
    setActiveTab(tab)
    if (tab !== 'schedule') {
      openModal(tab)
    }
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-gradient-to-r from-slate-800 via-slate-700 to-slate-800 border-t border-slate-600 z-50">
      <div className="flex items-center h-20 overflow-x-auto px-2 gap-1">
        {/* Schedule Tab */}
        <button
          onClick={() => handleTabClick('schedule')}
          className={`flex flex-col items-center justify-center h-full transition-colors px-2 min-w-16 ${
            activeTab === 'schedule' ? 'text-slate-200' : 'text-slate-400'
          }`}
        >
          <i className="fas fa-calendar-alt text-lg mb-1"></i>
          <span className="text-xs">לוח זמנים</span>
        </button>

        {/* Employees Tab */}
        <button
          onClick={() => handleTabClick('employees-list')}
          className={`flex flex-col items-center justify-center h-full transition-colors px-2 min-w-16 ${
            activeTab === 'employees-list' ? 'text-slate-200' : 'text-slate-400'
          }`}
        >
          <i className="fas fa-users text-lg mb-1"></i>
          <span className="text-xs">עובדים</span>
        </button>

        {/* Vehicles Tab */}
        <button
          onClick={() => handleTabClick('vehicle-list')}
          className={`flex flex-col items-center justify-center h-full transition-colors px-2 min-w-16 ${
            activeTab === 'vehicle-list' ? 'text-slate-200' : 'text-slate-400'
          }`}
        >
          <i className="fas fa-car text-lg mb-1"></i>
          <span className="text-xs">רכבים</span>
        </button>

        {/* Requests Tab */}
        <button
          onClick={() => handleTabClick('request')}
          className={`flex flex-col items-center justify-center h-full transition-colors px-2 min-w-16 ${
            activeTab === 'request' ? 'text-slate-200' : 'text-slate-400'
          }`}
        >
          <i className="fas fa-clipboard-list text-lg mb-1"></i>
          <span className="text-xs">בקשות</span>
        </button>

        {/* My Schedule Button */}
        <button
          onClick={() => openModal('my-schedule')}
          className="flex flex-col items-center justify-center h-full transition-colors px-2 text-purple-400 hover:text-purple-300 min-w-16"
        >
          <i className="fas fa-user-clock text-lg mb-1"></i>
          <span className="text-xs">המשמרות שלי</span>
        </button>

        {/* Summary Button */}
        <button
          onClick={() => openModal('summary')}
          className="flex flex-col items-center justify-center h-full transition-colors px-2 text-green-400 hover:text-green-300 min-w-16"
        >
          <i className="fab fa-whatsapp text-lg mb-1"></i>
          <span className="text-xs">צור סיכום</span>
        </button>

        {/* User Management Button - Only for Admins */}
        {canManageUsers() && (
          <button
            onClick={() => window.location.href = '/admin/users'}
            className="flex flex-col items-center justify-center h-full transition-colors px-2 text-red-400 hover:text-red-300 min-w-16"
          >
            <i className="fas fa-users-cog text-lg mb-1"></i>
            <span className="text-xs">ניהול משתמשים</span>
          </button>
        )}
      </div>
    </div>
  )
}
