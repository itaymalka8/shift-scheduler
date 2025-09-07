'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useScheduleStore } from '@/store/schedule-store'
import { useModalStore } from '@/store/modal-store'
import { ShareButton } from '@/components/share-button'

export function Header() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const { currentWeekOffset, changeWeek } = useScheduleStore()
  const { openModal } = useModalStore()

  const formatWeekDisplay = () => {
    const today = new Date()
    today.setDate(today.getDate() + (currentWeekOffset * 7))
    const sunday = getSunday(today)
    const saturday = new Date(sunday)
    saturday.setDate(sunday.getDate() + 6)
    return `${formatDate(sunday)} - ${formatDate(saturday)}`
  }

  const getSunday = (d: Date) => {
    d = new Date(d)
    const day = d.getDay()
    const diff = d.getDate() - day
    return new Date(d.setDate(diff))
  }

  const formatDate = (date: Date) => {
    return date.toLocaleString('he-IL', { day: '2-digit', month: '2-digit' })
  }

  return (
    <header className="main-header border-b bg-gradient-to-r from-slate-800 via-slate-700 to-slate-800 p-4 relative overflow-hidden">
      {/* Background Pattern */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-teal-500/20 to-blue-500/20"></div>
        <div className="absolute top-4 right-4 w-32 h-32 bg-teal-500/10 rounded-full blur-3xl"></div>
        <div className="absolute bottom-4 left-4 w-24 h-24 bg-blue-500/10 rounded-full blur-2xl"></div>
      </div>
      
      <div className="relative z-10 flex justify-between items-center">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-white to-teal-200 bg-clip-text text-transparent">
              מערכת ניהול משמרות מודיעין בילוש שפט
            </h1>
            <p className="text-slate-300 text-sm font-medium">
              {formatWeekDisplay()}
            </p>
          </div>
        </div>
        
        {/* Share Button */}
        <div className="share-button-container">
          <ShareButton />
        </div>
      </div>
    </header>
  )
}
