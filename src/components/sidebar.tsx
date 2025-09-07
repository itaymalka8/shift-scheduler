'use client'

import { useState } from 'react'
import { RequestsPanel } from '@/components/requests-panel'
import { useModalStore } from '@/store/modal-store'

export function Sidebar() {
  const [isOpen, setIsOpen] = useState(false)
  const { openModal } = useModalStore()

  const toggleSidebar = () => {
    setIsOpen(!isOpen)
  }

  const closeSidebar = () => {
    setIsOpen(false)
  }

  const handleModalOpen = (modalType: string) => {
    openModal(modalType)
    closeSidebar() // Close sidebar when opening modal
  }

  return (
    <>
      {/* Overlay */}
      <div 
        className={`sidebar-overlay ${isOpen ? 'open' : ''}`}
        onClick={closeSidebar}
      />
      
      {/* Sidebar */}
      <div className={`sidebar bg-slate-800 flex-col gap-8 text-slate-200 ${isOpen ? 'open' : ''}`}>
        {/* Close button for mobile */}
        <button
          onClick={closeSidebar}
          className="lg:hidden modal-close-btn"
          title="סגור תפריט"
        >
          ×
        </button>

        {/* Management Section */}
        <div className="mt-12 lg:mt-0">
          <h2 className="text-xl font-bold mb-4">ניהול</h2>
          <div className="space-y-3">
            <button
              onClick={() => handleModalOpen('employees-list')}
              className="w-full bg-orange-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-orange-700 transition-colors flex items-center justify-center text-md"
            >
              <i className="fas fa-users mr-3"></i>רשימת עובדים
            </button>
            <button
              onClick={() => handleModalOpen('vehicle-list')}
              className="w-full bg-orange-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-orange-700 transition-colors flex items-center justify-center text-md"
            >
              <i className="fas fa-car mr-3"></i>ניהול רכבים
            </button>
            <button
              onClick={() => handleModalOpen('work-plan')}
              className="w-full bg-orange-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-orange-700 transition-colors flex items-center justify-center text-md"
            >
              <i className="fas fa-calendar-alt mr-3"></i>תכנון עבודה
            </button>
          </div>
        </div>

        {/* Requests Panel */}
        <div className="flex flex-col flex-grow">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xl font-bold">בקשות עובדים</h3>
            <button
              onClick={() => handleModalOpen('request')}
              className="bg-teal-500 text-white px-3 py-1 rounded-full text-sm hover:bg-teal-600 transition-colors"
            >
              <i className="fas fa-plus"></i> הוסף בקשה
            </button>
          </div>
          <RequestsPanel />
        </div>
      </div>

      {/* Hamburger button for mobile */}
      <button
        onClick={toggleSidebar}
        className="lg:hidden hamburger-btn"
        title="פתח תפריט"
      >
        <i className="fas fa-bars"></i>
      </button>
    </>
  )
}
