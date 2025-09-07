'use client'

import { useState, useEffect } from 'react'
import { ScheduleBoard } from '@/components/schedule-board'
import { VerticalScheduleBoard } from '@/components/vertical-schedule-board'
import { WeeklyTableBoard } from '@/components/weekly-table-board'
import { Header } from '@/components/header'
import { BottomNavigation } from '@/components/bottom-navigation'
import { ModalContainer } from '@/components/modal-container'
import { useScheduleStore } from '@/store/schedule-store'
import { useEmployeesStore } from '@/store/employees-store'
import { useRequestsStore } from '@/store/requests-store'
import { useVehiclesStore } from '@/store/vehicles-store'
import { useWorkPlanStore } from '@/store/work-plan-store'

export default function SchedulePage() {
  const { initializeSchedule } = useScheduleStore()
  const { initializeEmployees } = useEmployeesStore()
  const { initializeRequests } = useRequestsStore()
  const { initializeVehicles } = useVehiclesStore()
  const { initializeWorkPlans } = useWorkPlanStore()

  useEffect(() => {
    const initializeApp = async () => {
      try {
        await Promise.all([
          initializeEmployees(),
          initializeSchedule(),
          initializeRequests(),
          initializeVehicles(),
          initializeWorkPlans()
        ])
      } catch (error) {
        console.error('Failed to initialize app:', error)
      }
    }

    initializeApp()
  }, [initializeEmployees, initializeSchedule, initializeRequests, initializeVehicles, initializeWorkPlans])

  return (
    <div className="main-content flex w-screen h-screen bg-slate-900 text-slate-800">
      <div className="flex-1 flex flex-col">
        <Header />
        <main className="schedule-board flex-1 overflow-auto p-4 sm:p-8">
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-3xl font-bold text-slate-100">סידור עבודה שבועי</h2>
                <p className="text-slate-300">ניהול הקצאת עובדים למשמרות</p>
              </div>
              
            </div>
            
            {/* Responsive Schedule Display */}
            <div className="hidden md:block">
              <WeeklyTableBoard />
            </div>
            <div className="md:hidden">
              <VerticalScheduleBoard />
            </div>
          </div>
        </main>
      </div>
      <BottomNavigation />
      <ModalContainer />
    </div>
  )
}
