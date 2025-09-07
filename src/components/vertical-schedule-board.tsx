'use client'

import { useState, useEffect } from 'react'
import { useScheduleStore } from '@/store/schedule-store'
import { useEmployeesStore } from '@/store/employees-store'
import { useModalStore } from '@/store/modal-store'
import { useWorkPlanStore } from '@/store/work-plan-store'
import { TaskCube } from '@/components/task-cube'

export function VerticalScheduleBoard() {
  const { currentWeekOffset, shifts, changeWeek, removeEmployeeFromShift, assignShift, initializeSchedule, getCurrentDate } = useScheduleStore()
  const { employees } = useEmployeesStore()
  const { openModal } = useModalStore()
  const { workPlans } = useWorkPlanStore()
  
  const [draggedAssignment, setDraggedAssignment] = useState<any>(null)
  const [dragOverShift, setDragOverShift] = useState<string | null>(null)
  const [dragOverEmployee, setDragOverEmployee] = useState<string | null>(null)

  // התחל מהשבוע הנוכחי
  useEffect(() => {
    initializeSchedule()
  }, [initializeSchedule])

  const daysOfWeek = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
  const shiftTypes = ['משמרת בוקר', 'משמרת צהריים', 'משמרת ערב']

  const getSunday = (d: Date) => {
    d = new Date(d)
    const day = d.getDay()
    const diff = d.getDate() - day
    return new Date(d.setDate(diff))
  }

  // פונקציה לקבלת יום ראשון של השבוע הנוכחי
  const getCurrentSunday = () => {
    const currentDate = getCurrentDate()
    const dayOfWeek = currentDate.getDay()
    const sunday = new Date(currentDate)
    sunday.setDate(currentDate.getDate() - dayOfWeek)
    return sunday
  }

  const formatDate = (date: Date) => {
    return date.toLocaleString('he-IL', { day: '2-digit', month: '2-digit' })
  }

  const getDateString = (date: Date) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  const getRoleIcon = (role: string) => {
    if (['קמ"ן', 'קמ"ן א', 'קמ"ן ב', 'קמב"ל', 'קמב"צ'].includes(role)) return '⭐️'
    if (role === 'ראש צוות') return '⭐'
    return ''
  }

  const getCategoryByRole = (role: string) => {
    const categoryMapping = {
      'פיקוד': ['קמב"צ', 'קמ"ן', 'קמב"ל', 'קמ"ן א', 'קמ"ן ב'],
      'רכז': ['רכז'],
      'בילוש': ['בלש', 'ראש צוות', 'סגן ראש צוות'],
      'הערכה/אחר': ['הערכה']
    }
    
    for (const [category, roles] of Object.entries(categoryMapping)) {
      if (roles.includes(role)) return category
    }
    return 'אחר'
  }

  const sunday = getCurrentSunday()
  sunday.setDate(sunday.getDate() + currentWeekOffset * 7)

  const handleDragStart = (e: React.DragEvent, assignment: any) => {
    setDraggedAssignment(assignment)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent, shiftId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverShift(shiftId)
  }

  const handleDragLeave = () => {
    setDragOverShift(null)
  }

  const handleDrop = async (e: React.DragEvent, shiftId: string) => {
    e.preventDefault()
    
    if (draggedAssignment && draggedAssignment.shiftId !== shiftId) {
      // Remove from old shift
      await removeEmployeeFromShift(draggedAssignment.shiftId, draggedAssignment.employeeId)
      
      // Add to new shift
      await assignShift(shiftId, draggedAssignment.employeeId)
    }
    
    setDraggedAssignment(null)
    setDragOverShift(null)
  }

  const handleEmployeeDragOver = (e: React.DragEvent, employeeId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverEmployee(employeeId)
  }

  const handleEmployeeDragLeave = () => {
    setDragOverEmployee(null)
  }

  const handleEmployeeDrop = async (e: React.DragEvent, employeeId: string) => {
    e.preventDefault()
    
    if (draggedAssignment && draggedAssignment.employeeId !== employeeId) {
      // Swap employees
      const oldEmployeeId = draggedAssignment.employeeId
      const shiftId = draggedAssignment.shiftId
      
      // Remove both employees
      await removeEmployeeFromShift(shiftId, oldEmployeeId)
      await removeEmployeeFromShift(shiftId, employeeId)
      
      // Add them back swapped
      await assignShift(shiftId, employeeId)
      await assignShift(shiftId, oldEmployeeId)
    }
    
    setDraggedAssignment(null)
    setDragOverEmployee(null)
  }

  const handleShiftClick = (day: string, shiftType: string) => {
    const dayIndex = daysOfWeek.indexOf(day)
    const currentDate = new Date(sunday)
    currentDate.setDate(sunday.getDate() + dayIndex)
    const dateString = getDateString(currentDate)
    openModal('assignment', { date: dateString, shiftType })
  }

  const handleRemoveEmployee = async (shiftId: string, employeeId: string) => {
    await removeEmployeeFromShift(shiftId, employeeId)
  }

  const getShiftId = (day: string, shiftType: string) => {
    const dayIndex = daysOfWeek.indexOf(day)
    const currentDate = new Date(sunday)
    currentDate.setDate(sunday.getDate() + dayIndex)
    return `${getDateString(currentDate)}-${shiftType}`
  }

  const getShiftAssignments = (day: string, shiftType: string) => {
    const shiftId = getShiftId(day, shiftType)
    const shiftData = shifts[shiftId]
    
    // Return empty array if no shift data
    if (!shiftData) return []
    
    // Handle different shift data formats
    if (Array.isArray(shiftData)) {
      return shiftData
    } else if (shiftData.assignments && Array.isArray(shiftData.assignments)) {
      return shiftData.assignments.map((assignment: any) => assignment.employeeId)
    } else if (typeof shiftData === 'object') {
      return Object.keys(shiftData)
    }
    
    return []
  }

  const getEmployeeById = (id: string) => {
    return employees.find(emp => emp.id === id)
  }

  const getWorkPlanForDay = (date: Date) => {
    const dateString = getDateString(date)
    return workPlans[dateString] || null
  }

  const getTasksForShift = (date: Date, shiftType: string) => {
    const workPlan = getWorkPlanForDay(date)
    if (!workPlan) return { general: [], shift: [] }
    
    const generalTasks = workPlan.generalTasks || []
    const shiftKey = shiftType === 'משמרת בוקר' ? 'morning' : 
                    shiftType === 'משמרת צהריים' ? 'afternoon' : 'evening'
    const shiftTasks = workPlan.shiftTasks?.[shiftKey] || []
    
    return { general: generalTasks, shift: shiftTasks }
  }

  const groupEmployeesByCategory = (assignments: any) => {
    const grouped: { [key: string]: any[] } = {}
    
    // Handle different assignment formats
    let employeeIds: string[] = []
    
    if (Array.isArray(assignments)) {
      // If it's an array of employee IDs
      employeeIds = assignments
    } else if (assignments && assignments.assignments && Array.isArray(assignments.assignments)) {
      // If it's an object with assignments array
      employeeIds = assignments.assignments.map((assignment: any) => assignment.employeeId)
    } else if (assignments && typeof assignments === 'object') {
      // If it's an object with employee IDs as keys
      employeeIds = Object.keys(assignments)
    }
    
    employeeIds.forEach(employeeId => {
      const employee = getEmployeeById(employeeId)
      if (employee) {
        const category = getCategoryByRole(employee.role)
        if (!grouped[category]) {
          grouped[category] = []
        }
        grouped[category].push(employee)
      }
    })
    
    return grouped
  }

  return (
    <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-2xl overflow-hidden border border-white/20">
      {/* Enhanced Week Navigation Header */}
      <div className="bg-gradient-to-r from-slate-800 via-slate-700 to-slate-800 text-white p-6 relative overflow-hidden">
        {/* Background Pattern */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-teal-500/20 to-blue-500/20"></div>
          <div className="absolute top-4 right-4 w-32 h-32 bg-teal-500/10 rounded-full blur-3xl"></div>
          <div className="absolute bottom-4 left-4 w-24 h-24 bg-blue-500/10 rounded-full blur-2xl"></div>
        </div>
        
        <div className="relative z-10 flex justify-between items-center">
          <button
            onClick={() => changeWeek(-1)}
            className="btn btn-secondary px-6 py-3 rounded-xl transition-all duration-300 hover:scale-105 flex items-center gap-2"
          >
            <span className="font-semibold">שבוע קודם</span>
          </button>
          
          <div className="text-center">
            <div className="flex items-center justify-center gap-3 mb-2">
              <div className="icon icon-primary">
                <i className="fas fa-calendar-week text-lg"></i>
              </div>
              <h2 className="text-2xl font-bold bg-gradient-to-r from-white to-teal-200 bg-clip-text text-transparent">
                סידור עבודה שבועי
              </h2>
            </div>
            <div className="flex items-center justify-center gap-2 text-slate-300">
              <i className="fas fa-calendar-alt text-sm"></i>
              <p className="text-sm font-medium">
                {formatDate(sunday)} - {formatDate(new Date(sunday.getTime() + 6 * 24 * 60 * 60 * 1000))}
              </p>
            </div>
            {/* כפתור שבוע נוכחי */}
            <button
              onClick={() => initializeSchedule()}
              className="mt-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm rounded-lg transition-all duration-300 hover:scale-105 flex items-center gap-2 mx-auto"
            >
              <i className="fas fa-home"></i>
              <span>שבוע נוכחי</span>
            </button>
          </div>
          
          <button
            onClick={() => changeWeek(1)}
            className="btn btn-secondary px-6 py-3 rounded-xl transition-all duration-300 hover:scale-105 flex items-center gap-2"
          >
            <span className="font-semibold">שבוע הבא</span>
          </button>
        </div>
      </div>

      {/* Vertical Days List */}
      <div className="p-4 space-y-4 max-w-6xl mx-auto">
        {daysOfWeek.map((day, index) => {
          const currentDate = new Date(sunday)
          currentDate.setDate(sunday.getDate() + index)
          
          return (
            <div key={day} className="bg-white/90 backdrop-blur-sm rounded-xl p-4 md:p-6 border border-white/30 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.02]">
              {/* Enhanced Day Header */}
              <div className="flex justify-between items-center mb-4 md:mb-6">
                <div className="flex items-center gap-2 md:gap-4">
                  <div className="icon icon-secondary">
                    <i className="fas fa-calendar-day text-lg"></i>
                  </div>
                  <div>
                    <h3 className="text-lg md:text-xl font-bold text-slate-800">{day}</h3>
                    <p className="text-xs md:text-sm text-slate-600 font-medium">{formatDate(currentDate)}</p>
                  </div>
                </div>
                <div className="text-xs text-slate-500 bg-slate-100 px-2 md:px-3 py-1 rounded-full font-medium">
                  {currentDate.toLocaleDateString('he-IL', { weekday: 'long' })}
                </div>
              </div>

              {/* Day Summary - Employee Count */}
              <div className="day-summary">
                <div className="day-summary-header">
                  <button 
                    onClick={() => openModal('day-assignment', { date: getDateString(currentDate) })}
                    className="day-summary-btn text-sm md:text-base"
                  >
                    <i className="fas fa-user-plus mr-2"></i>
                    שיבוץ עובדים
                  </button>
                </div>
                
                {/* Employee Statistics */}
                <div className="employee-stats">
                  <div className="stats-grid">
                    {shiftTypes.map((shiftType) => {
                      const assignments = getShiftAssignments(day, shiftType)
                      const count = assignments.length
                      const shiftIcon = shiftType === 'משמרת בוקר' ? '🌅' : 
                                      shiftType === 'משמרת צהריים' ? '☀️' : '🌙'
                      const shiftName = shiftType === 'משמרת בוקר' ? 'בוקר' : 
                                      shiftType === 'משמרת צהריים' ? 'צהריים' : 'ערב'
                      
                      return (
                        <div key={shiftType} className="stat-item">
                          <div className="stat-icon text-lg md:text-xl">{shiftIcon}</div>
                          <div className="stat-content">
                            <div className="stat-label text-xs md:text-sm">{shiftName}</div>
                            <div className={`stat-number text-lg md:text-xl font-bold ${count > 0 ? 'active' : 'inactive'}`}>
                              {count}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  
                  <div className="total-stats">
                    <div className="total-item">
                      <i className="fas fa-users text-blue-600 text-sm md:text-base"></i>
                      <span className="total-label text-xs md:text-sm">סה"כ עובדים:</span>
                      <span className="total-number text-lg md:text-xl font-bold">
                        {shiftTypes.reduce((total, shiftType) => {
                          return total + getShiftAssignments(day, shiftType).length
                        }, 0)}
                      </span>
                    </div>
                    <div className="total-item">
                      <i className="fas fa-user-slash text-gray-500 text-sm md:text-base"></i>
                      <span className="total-label text-xs md:text-sm">לא עובדים:</span>
                      <span className="total-number text-lg md:text-xl font-bold">
                        {employees.length - shiftTypes.reduce((total, shiftType) => {
                          return total + getShiftAssignments(day, shiftType).length
                        }, 0)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Work Plan for the Day - Inside Summary */}
                {(() => {
                  const workPlan = getWorkPlanForDay(currentDate)
                  const hasGeneralTasks = workPlan && workPlan.generalTasks && workPlan.generalTasks.length > 0
                  const hasShiftTasks = workPlan && workPlan.shiftTasks && 
                    (workPlan.shiftTasks.morning?.length > 0 || 
                     workPlan.shiftTasks.afternoon?.length > 0 || 
                     workPlan.shiftTasks.evening?.length > 0)
                  
                  if (hasGeneralTasks || hasShiftTasks) {
                    return (
                      <div className="work-plan-summary">
                        <div className="work-plan-header">
                          <div className="work-plan-title">
                            <i className="fas fa-tasks text-teal-600 text-sm md:text-base"></i>
                            <span className="text-sm md:text-base">תכנון עבודה ליום</span>
                          </div>
                          <button 
                            onClick={() => openModal('work-plan', { date: getDateString(currentDate) })}
                            className="edit-plan-btn text-sm md:text-base"
                          >
                            <i className="fas fa-edit"></i>
                          </button>
                        </div>
                        
                        {hasGeneralTasks && (
                          <div className="work-plan-section">
                            <div className="section-header">
                              <i className="fas fa-globe text-blue-600 text-sm md:text-base"></i>
                              <span className="text-sm md:text-base">משימות כלליות</span>
                            </div>
                            <div className="work-plan-activities">
                              {workPlan.generalTasks.map((task: string, index: number) => (
                                <TaskCube key={index} task={task} date={getDateString(currentDate)} />
                              ))}
                            </div>
                          </div>
                        )}
                        
                        {hasShiftTasks && (
                          <div className="work-plan-section">
                            <div className="section-header">
                              <i className="fas fa-clock text-teal-600 text-sm md:text-base"></i>
                              <span className="text-sm md:text-base">משימות לפי משמרות</span>
                            </div>
                            <div className="work-plan-shifts">
                              {(['morning', 'afternoon', 'evening'] as const).map((shift) => {
                                const tasks = workPlan.shiftTasks?.[shift] || []
                                if (tasks.length === 0) return null
                                
                                const shiftName = shift === 'morning' ? 'בוקר' : 
                                                shift === 'afternoon' ? 'צהריים' : 'ערב'
                                const shiftIcon = shift === 'morning' ? '🌅' : 
                                                shift === 'afternoon' ? '☀️' : '🌙'
                                
                                return (
                                  <div key={shift} className="work-plan-shift">
                                    <div className="work-plan-shift-header">
                                      <span className="shift-icon text-sm md:text-base">{shiftIcon}</span>
                                      <span className="shift-name text-sm md:text-base">{shiftName}</span>
                                    </div>
                                    <div className="work-plan-activities">
                                      {tasks.map((task: string, index: number) => (
                                        <div key={index} className="work-plan-activity shift">
                                          <i className="fas fa-list-ul activity-icon text-xs md:text-sm"></i>
                                          <span className="activity-text text-xs md:text-sm">{task}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  } else {
                    return (
                      <div className="work-plan-summary empty">
                        <div className="work-plan-header">
                          <div className="work-plan-title">
                            <i className="fas fa-tasks text-gray-500 text-sm md:text-base"></i>
                            <span className="text-sm md:text-base">תכנון עבודה ליום</span>
                          </div>
                        </div>
                        <div className="work-plan-empty">
                          <div className="empty-content">
                            <i className="fas fa-plus-circle empty-icon text-sm md:text-base"></i>
                            <span className="empty-text text-xs md:text-sm">אין תכנון עבודה ליום זה</span>
                          </div>
                          <button 
                            onClick={() => openModal('work-plan', { date: getDateString(currentDate) })}
                            className="add-plan-btn text-sm md:text-base"
                          >
                            <i className="fas fa-plus mr-2"></i>
                            הוסף תכנון
                          </button>
                        </div>
                      </div>
                    )
                  }
                })()}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}