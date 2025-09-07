'use client'

import { useState, useEffect } from 'react'
import { useScheduleStore } from '@/store/schedule-store'
import { useEmployeesStore } from '@/store/employees-store'
import { useModalStore } from '@/store/modal-store'
import { useWorkPlanStore } from '@/store/work-plan-store'
import { TaskCube } from '@/components/task-cube'
import { TaskManager } from '@/components/task-manager'

export function WeeklyTableBoard() {
  const { currentWeekOffset, shifts, changeWeek, removeEmployeeFromShift, assignShift, initializeSchedule, getCurrentDate } = useScheduleStore()
  const { employees } = useEmployeesStore()
  const { openModal } = useModalStore()
  const { workPlans, updateWorkPlan, addWorkPlan } = useWorkPlanStore()
  
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
    return date.toLocaleDateString('he-IL', { 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric' 
    })
  }

  const getDateString = (date: Date) => {
    return date.toISOString().split('T')[0]
  }

  const getShiftAssignments = (day: string, shiftType: string) => {
    const dayIndex = daysOfWeek.indexOf(day)
    const sunday = getCurrentSunday()
    sunday.setDate(sunday.getDate() + currentWeekOffset * 7)
    const currentDate = new Date(sunday)
    currentDate.setDate(sunday.getDate() + dayIndex)
    
    const shiftKey = `${getDateString(currentDate)}_${shiftType}`
    const shift = shifts[shiftKey]
    return shift ? shift.assignments : []
  }

  const getWorkPlanForDay = (date: Date) => {
    const dateString = getDateString(date)
    return workPlans[dateString]
  }
  const updateShiftTasks = async (date: Date, shiftType: 'morning' | 'afternoon' | 'evening', tasks: string[]) => {
    const dateString = getDateString(date)
    const existingWorkPlan = getWorkPlanForDay(date)
    
    if (existingWorkPlan) {
      // עדכן תכנון עבודה קיים
      await updateWorkPlan(existingWorkPlan.id, {
        shiftTasks: {
          ...existingWorkPlan.shiftTasks,
          [shiftType]: tasks
        }
      })
    } else {
      // צור תכנון עבודה חדש
      await addWorkPlan({
        date: dateString,
        generalTasks: [],
        shiftTasks: {
          morning: shiftType === 'morning' ? tasks : [],
          afternoon: shiftType === 'afternoon' ? tasks : [],
          evening: shiftType === 'evening' ? tasks : []
        },
        notes: '',
        startTime: '08:00',
        endTime: '16:00'
      })
    }
  }

  // פונקציה לחישוב סיכום המשמרות
  const getShiftSummary = (day: string, shiftType: string) => {
    const assignments = getShiftAssignments(day, shiftType)
    const totalEmployees = employees.length
    const workingEmployees = assignments.length
    const notWorkingEmployees = totalEmployees - workingEmployees
    
    return {
      working: workingEmployees,
      notWorking: notWorkingEmployees,
      total: totalEmployees
    }
  }

  // פונקציה לקבלת עובדים לפי משימה
  const getEmployeesByTask = (date: Date, task: string) => {
    const dateString = getDateString(date)
    const dayIndex = daysOfWeek.indexOf(daysOfWeek.find(d => {
      const sunday = getCurrentSunday()
      sunday.setDate(sunday.getDate() + currentWeekOffset * 7)
      const currentDate = new Date(sunday)
      currentDate.setDate(sunday.getDate() + daysOfWeek.indexOf(d))
      return getDateString(currentDate) === dateString
    }) || 'ראשון')
    
    const sunday = getCurrentSunday()
    sunday.setDate(sunday.getDate() + currentWeekOffset * 7)
    const currentDate = new Date(sunday)
    currentDate.setDate(sunday.getDate() + dayIndex)
    
    const assignments = shiftTypes.flatMap(shiftType => {
      const shiftKey = `${getDateString(currentDate)}_${shiftType}`
      const shift = shifts[shiftKey]
      return shift ? shift.assignments.filter(assignment => 
        assignment.tasks && assignment.tasks.includes(task)
      ) : []
    })
    
    return assignments.map(assignment => {
      const employee = employees.find(emp => emp.id === assignment.employeeId)
      return employee
    }).filter(Boolean)
  }

  const handleDragStart = (e: React.DragEvent, assignment: any, shiftKey: string) => {
    setDraggedAssignment({ ...assignment, fromShiftKey: shiftKey })
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent, shiftKey: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverShift(shiftKey)
  }

  const handleDragLeave = () => {
    setDragOverShift(null)
  }

  const handleDrop = async (e: React.DragEvent, targetShiftKey: string) => {
    e.preventDefault()
    
    if (draggedAssignment && draggedAssignment.fromShiftKey !== targetShiftKey) {
      try {
        // הסר מהמשמרת המקורית
        await removeEmployeeFromShift(draggedAssignment.fromShiftKey, draggedAssignment.employeeId)
        
        // הוסף למשמרת החדשה
        await assignShift(targetShiftKey, draggedAssignment.employeeId, draggedAssignment.status, draggedAssignment.note)
        
        // אם יש משימות, העבר גם אותן
        if (draggedAssignment.tasks && draggedAssignment.tasks.length > 0) {
          // כאן נוכל להוסיף לוגיקה להעברת משימות
        }
      } catch (error) {
        console.error('Error moving assignment:', error)
      }
    }
    
    setDraggedAssignment(null)
    setDragOverShift(null)
  }

  const sunday = getCurrentSunday()
  sunday.setDate(sunday.getDate() + currentWeekOffset * 7)

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

      {/* Weekly Table - Desktop Only */}
      <div className="p-6 max-w-7xl mx-auto">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-slate-100">
                <th className="border border-slate-300 p-4 text-right font-bold text-slate-800">יום</th>
                <th className="border border-slate-300 p-4 text-center font-bold text-slate-800">בוקר</th>
                <th className="border border-slate-300 p-4 text-center font-bold text-slate-800">צהריים</th>
                <th className="border border-slate-300 p-4 text-center font-bold text-slate-800">ערב</th>
                <th className="border border-slate-300 p-4 text-center font-bold text-slate-800">תכנון עבודה</th>
              </tr>
            </thead>
            <tbody>
              {daysOfWeek.map((day, index) => {
                const currentDate = new Date(sunday)
                currentDate.setDate(sunday.getDate() + index)
                
                return (
                  <tr key={day} className="hover:bg-slate-50 transition-colors">
                    {/* Day Column */}
                    <td className="border border-slate-300 p-4 text-right">
                      <div className="flex flex-col items-end">
                        <h3 className="text-lg font-bold text-slate-800">{day}</h3>
                        <p className="text-sm text-slate-600">{formatDate(currentDate)}</p>
                        <button 
                          onClick={() => openModal('day-assignment', { date: getDateString(currentDate) })}
                          className="mt-2 px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg transition-all duration-300 hover:scale-105 flex items-center gap-1"
                        >
                          <i className="fas fa-user-plus"></i>
                          <span>שיבוץ</span>
                        </button>
                      </div>
                    </td>
                    
                    {/* Morning Shift */}
                    <td className="border border-slate-300 p-4">
                      <div 
                        className="min-h-[120px] p-3 bg-gradient-to-br from-orange-100 to-orange-200 rounded-lg border border-orange-300"
                        onDragOver={(e) => handleDragOver(e, `${getDateString(currentDate)}_משמרת בוקר`)}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, `${getDateString(currentDate)}_משמרת בוקר`)}
                      >
                        <div className="text-center mb-2">
                          <span className="text-lg">🌅</span>
                          <p className="text-sm font-semibold text-orange-800">בוקר</p>
                          {(() => {
                            const summary = getShiftSummary(day, 'משמרת בוקר')
                            return (
                              <div className="text-xs text-orange-700 mt-1">
                                <span className="bg-orange-200 px-2 py-1 rounded-full mr-1">
                                  עובדים: {summary.working}
                                </span>
                                <span className="bg-orange-100 px-2 py-1 rounded-full">
                                  לא עובדים: {summary.notWorking}
                                </span>
                              </div>
                            )
                          })()}
                        </div>
                        <div className="space-y-2">
                          {getShiftAssignments(day, 'משמרת בוקר').map((assignment, idx) => {
                            const employee = employees.find(emp => emp.id === assignment.employeeId)
                            return (
                              <div
                                key={idx}
                                draggable
                                onDragStart={(e) => handleDragStart(e, assignment, `${getDateString(currentDate)}_משמרת בוקר`)}
                                className="bg-white/80 p-2 rounded-lg border border-orange-400 cursor-move hover:bg-white transition-colors"
                              >
                                <p className="text-sm font-medium text-slate-800">{employee?.name}</p>
                                {assignment.tasks && assignment.tasks.length > 0 && (
                                  <div className="mt-1 space-y-1">
                                    {assignment.tasks.map((task, taskIdx) => (
                                      <div
                                        key={taskIdx}
                                        onClick={() => openModal('task-employees', { 
                                          task, 
                                          date: getDateString(currentDate),
                                          employees: getEmployeesByTask(currentDate, task)
                                        })}
                                        className="bg-orange-100 hover:bg-orange-200 px-2 py-1 rounded text-xs cursor-pointer transition-colors"
                                      >
                                        {task}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                          
                          {/* תכנון עבודה למשמרת בוקר */}
                          {(() => {
                            const workPlan = getWorkPlanForDay(currentDate)
                            const morningTasks = workPlan?.shiftTasks?.morning || []
                            return (
                              <TaskManager
                                date={getDateString(currentDate)}
                                shiftType="morning"
                                tasks={morningTasks}
                                onTasksChange={(tasks) => updateShiftTasks(currentDate, 'morning', tasks)}
                              />
                            )
                          })()}
                        </div>
                      </div>
                    </td>
                    
                    {/* Afternoon Shift */}
                    <td className="border border-slate-300 p-4">
                      <div 
                        className="min-h-[120px] p-3 bg-gradient-to-br from-yellow-100 to-yellow-200 rounded-lg border border-yellow-300"
                        onDragOver={(e) => handleDragOver(e, `${getDateString(currentDate)}_משמרת צהריים`)}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, `${getDateString(currentDate)}_משמרת צהריים`)}
                      >
                        <div className="text-center mb-2">
                          <span className="text-lg">☀️</span>
                          <p className="text-sm font-semibold text-yellow-800">צהריים</p>
                          {(() => {
                            const summary = getShiftSummary(day, 'משמרת צהריים')
                            return (
                              <div className="text-xs text-yellow-700 mt-1">
                                <span className="bg-yellow-200 px-2 py-1 rounded-full mr-1">
                                  עובדים: {summary.working}
                                </span>
                                <span className="bg-yellow-100 px-2 py-1 rounded-full">
                                  לא עובדים: {summary.notWorking}
                                </span>
                              </div>
                            )
                          })()}
                        </div>
                        <div className="space-y-2">
                          {getShiftAssignments(day, 'משמרת צהריים').map((assignment, idx) => {
                            const employee = employees.find(emp => emp.id === assignment.employeeId)
                            return (
                              <div
                                key={idx}
                                draggable
                                onDragStart={(e) => handleDragStart(e, assignment, `${getDateString(currentDate)}_משמרת צהריים`)}
                                className="bg-white/80 p-2 rounded-lg border border-yellow-400 cursor-move hover:bg-white transition-colors"
                              >
                                <p className="text-sm font-medium text-slate-800">{employee?.name}</p>
                                {assignment.tasks && assignment.tasks.length > 0 && (
                                  <div className="mt-1 space-y-1">
                                    {assignment.tasks.map((task, taskIdx) => (
                                      <div
                                        key={taskIdx}
                                        onClick={() => openModal('task-employees', { 
                                          task, 
                                          date: getDateString(currentDate),
                                          employees: getEmployeesByTask(currentDate, task)
                                        })}
                                        className="bg-yellow-100 hover:bg-yellow-200 px-2 py-1 rounded text-xs cursor-pointer transition-colors"
                                      >
                                        {task}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                          
                          {/* תכנון עבודה למשמרת צהריים */}
                          {(() => {
                            const workPlan = getWorkPlanForDay(currentDate)
                            const afternoonTasks = workPlan?.shiftTasks?.afternoon || []
                            return (
                              <TaskManager
                                date={getDateString(currentDate)}
                                shiftType="afternoon"
                                tasks={afternoonTasks}
                                onTasksChange={(tasks) => updateShiftTasks(currentDate, 'afternoon', tasks)}
                              />
                            )
                          })()}
                        </div>
                      </div>
                    </td>
                    
                    {/* Evening Shift */}
                    <td className="border border-slate-300 p-4">
                      <div 
                        className="min-h-[120px] p-3 bg-gradient-to-br from-purple-100 to-purple-200 rounded-lg border border-purple-300"
                        onDragOver={(e) => handleDragOver(e, `${getDateString(currentDate)}_משמרת ערב`)}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, `${getDateString(currentDate)}_משמרת ערב`)}
                      >
                        <div className="text-center mb-2">
                          <span className="text-lg">🌙</span>
                          <p className="text-sm font-semibold text-purple-800">ערב</p>
                          {(() => {
                            const summary = getShiftSummary(day, 'משמרת ערב')
                            return (
                              <div className="text-xs text-purple-700 mt-1">
                                <span className="bg-purple-200 px-2 py-1 rounded-full mr-1">
                                  עובדים: {summary.working}
                                </span>
                                <span className="bg-purple-100 px-2 py-1 rounded-full">
                                  לא עובדים: {summary.notWorking}
                                </span>
                              </div>
                            )
                          })()}
                        </div>
                        <div className="space-y-2">
                          {getShiftAssignments(day, 'משמרת ערב').map((assignment, idx) => {
                            const employee = employees.find(emp => emp.id === assignment.employeeId)
                            return (
                              <div
                                key={idx}
                                draggable
                                onDragStart={(e) => handleDragStart(e, assignment, `${getDateString(currentDate)}_משמרת ערב`)}
                                className="bg-white/80 p-2 rounded-lg border border-purple-400 cursor-move hover:bg-white transition-colors"
                              >
                                <p className="text-sm font-medium text-slate-800">{employee?.name}</p>
                                {assignment.tasks && assignment.tasks.length > 0 && (
                                  <div className="mt-1 space-y-1">
                                    {assignment.tasks.map((task, taskIdx) => (
                                      <div
                                        key={taskIdx}
                                        onClick={() => openModal('task-employees', { 
                                          task, 
                                          date: getDateString(currentDate),
                                          employees: getEmployeesByTask(currentDate, task)
                                        })}
                                        className="bg-purple-100 hover:bg-purple-200 px-2 py-1 rounded text-xs cursor-pointer transition-colors"
                                      >
                                        {task}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                          
                          {/* תכנון עבודה למשמרת ערב */}
                          {(() => {
                            const workPlan = getWorkPlanForDay(currentDate)
                            const eveningTasks = workPlan?.shiftTasks?.evening || []
                            return (
                              <TaskManager
                                date={getDateString(currentDate)}
                                shiftType="evening"
                                tasks={eveningTasks}
                                onTasksChange={(tasks) => updateShiftTasks(currentDate, 'evening', tasks)}
                              />
                            )
                          })()}
                        </div>
                      </div>
                    </td>
                    
                    {/* Work Plan Column */}
                    <td className="border border-slate-300 p-4">
                      <div className="min-h-[120px] p-3 bg-gradient-to-br from-teal-100 to-teal-200 rounded-lg border border-teal-300">
                        <div className="text-center mb-2">
                          <span className="text-lg">📋</span>
                          <p className="text-sm font-semibold text-teal-800">תכנון עבודה</p>
                        </div>
                        {(() => {
                          const workPlan = getWorkPlanForDay(currentDate)
                          const hasGeneralTasks = workPlan && workPlan.generalTasks && workPlan.generalTasks.length > 0
                          const hasShiftTasks = workPlan && workPlan.shiftTasks && 
                            (workPlan.shiftTasks.morning?.length > 0 || 
                             workPlan.shiftTasks.afternoon?.length > 0 || 
                             workPlan.shiftTasks.evening?.length > 0)
                          
                          if (hasGeneralTasks || hasShiftTasks) {
                            return (
                              <div className="space-y-2">
                                {hasGeneralTasks && workPlan.generalTasks.map((task: string, index: number) => (
                                  <TaskCube key={index} task={task} date={getDateString(currentDate)} />
                                ))}
                                {hasShiftTasks && (['morning', 'afternoon', 'evening'] as const).map((shift) => {
                                  const tasks = workPlan.shiftTasks?.[shift] || []
                                  if (tasks.length === 0) return null
                                  
                                  return tasks.map((task: string, index: number) => (
                                    <TaskCube key={`${shift}-${index}`} task={task} date={getDateString(currentDate)} />
                                  ))
                                })}
                              </div>
                            )
                          } else {
                            return (
                              <div className="text-center">
                                <button 
                                  onClick={() => openModal('work-plan', { date: getDateString(currentDate) })}
                                  className="px-3 py-2 bg-teal-600 hover:bg-teal-700 text-white text-xs rounded-lg transition-all duration-300 hover:scale-105 flex items-center gap-1 mx-auto"
                                >
                                  <i className="fas fa-plus"></i>
                                  <span>הוסף תכנון</span>
                                </button>
                              </div>
                            )
                          }
                        })()}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
