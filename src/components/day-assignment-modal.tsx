'use client'

import React, { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useModalStore } from '@/store/modal-store'
import { useScheduleStore } from '@/store/schedule-store'
import { useEmployeesStore } from '@/store/employees-store'
import { useWorkPlanStore } from '@/store/work-plan-store'
import { useLoadingStore } from '@/store/loading-store'

const SHIFT_TYPES = [
  { key: 'morning', name: 'משמרת בוקר', icon: '🌅' },
  { key: 'afternoon', name: 'משמרת צהריים', icon: '☀️' },
  { key: 'evening', name: 'משמרת ערב', icon: '🌙' }
]

export function DayAssignmentModal() {
  const { activeModal, modalData, closeModal } = useModalStore()
  const { shifts, assignShift, removeEmployeeFromShift, assignEmployeeToTasks } = useScheduleStore()
  const { employees } = useEmployeesStore()
  const { workPlans } = useWorkPlanStore()
  const { setLoading } = useLoadingStore()
  
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null)
  const [selectedShift, setSelectedShift] = useState<string | null>(null)
  const [selectedTasks, setSelectedTasks] = useState<string[]>([])
  const [showEmployeeSelector, setShowEmployeeSelector] = useState(false)
  const [showTaskSelector, setShowTaskSelector] = useState(false)

  if (activeModal !== 'day-assignment') return null

  // Auto-fill date if provided in modalData
  useEffect(() => {
    if (modalData && modalData.date) {
      setSelectedDate(modalData.date)
    }
  }, [modalData])

  const getWorkPlanForDate = (date: string) => {
    return workPlans[date] || null
  }

  const getShiftId = (shiftType: string) => {
    return `${selectedDate}-${shiftType}`
  }

  const getShiftAssignments = (shiftType: string) => {
    const shiftId = getShiftId(shiftType)
    const shiftData = shifts[shiftId]
    
    if (!shiftData) return []
    
    if (Array.isArray(shiftData)) {
      return shiftData
    } else if (shiftData.assignments && Array.isArray(shiftData.assignments)) {
      return shiftData.assignments.map((assignment: any) => assignment.employeeId)
    } else if (typeof shiftData === 'object') {
      return Object.keys(shiftData)
    }
    
    return []
  }

  const getEmployeeTasks = (employeeId: string, shiftType: string) => {
    const shiftId = getShiftId(shiftType)
    const shiftData = shifts[shiftId]
    
    if (!shiftData || !shiftData.assignments) return []
    
    const assignment = shiftData.assignments.find((assignment: any) => assignment.employeeId === employeeId)
    return assignment?.tasks || []
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

  const handleAssignEmployee = async (employeeId: string, shiftType: string, tasks?: string[]) => {
    setLoading(true)
    try {
      const shiftId = getShiftId(shiftType)
      await assignShift(shiftId, employeeId)
      
      // Assign employee to tasks if specified
      if (tasks && tasks.length > 0) {
        await assignEmployeeToTasks(shiftId, employeeId, tasks)
      }
      
      // Reset selections
      setSelectedEmployeeId(null)
      setSelectedShift(null)
      setSelectedTasks([])
      setShowEmployeeSelector(false)
    } catch (error) {
      console.error('Error assigning employee:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleRemoveEmployee = async (employeeId: string, shiftType: string) => {
    setLoading(true)
    try {
      const shiftId = getShiftId(shiftType)
      await removeEmployeeFromShift(shiftId, employeeId)
    } catch (error) {
      console.error('Error removing employee:', error)
    } finally {
      setLoading(false)
    }
  }

  const openTaskSelector = (shiftType: string) => {
    setSelectedShift(shiftType)
    setSelectedTasks([])
    setShowTaskSelector(true)
  }

  const openEmployeeSelector = (shiftType: string, tasks?: string[]) => {
    setSelectedShift(shiftType)
    setSelectedTasks(tasks || [])
    setShowEmployeeSelector(true)
  }

  const getAvailableEmployees = (shiftType: string) => {
    const assignedEmployees = getShiftAssignments(shiftType)
    return employees.filter(emp => !assignedEmployees.includes(emp.id))
  }

  const getEmployeeById = (id: string) => {
    return employees.find(emp => emp.id === id)
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00')
    return date.toLocaleString('he-IL', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    })
  }

  const workPlan = getWorkPlanForDate(selectedDate)

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[10001] p-2 sm:p-4 animate-in fade-in-0 duration-300">
      <div className="bg-white rounded-2xl shadow-2xl p-4 sm:p-6 w-full max-w-6xl max-h-[95vh] sm:max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-300">
        <div className="flex justify-between items-center mb-4 sm:mb-6 border-b border-slate-200 pb-3 sm:pb-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-800 flex items-center gap-2">
              <i className="fas fa-users text-teal-600"></i>
              שיבוץ עובדים ליום
            </h2>
            <p className="text-slate-600 text-sm sm:text-base">{formatDate(selectedDate)}</p>
          </div>
          <button
            onClick={closeModal}
            className="text-slate-400 hover:text-slate-600 text-2xl sm:text-3xl transition-colors bg-slate-100 hover:bg-slate-200 rounded-full p-2"
          >
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="space-y-6">
          {/* Work Plan Summary */}
          {workPlan && (
            <div className="bg-gradient-to-r from-teal-50 to-blue-50 rounded-xl p-4 border border-teal-200">
              <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
                <i className="fas fa-tasks text-teal-600"></i>
                תכנון עבודה ליום
              </h3>
              
              {workPlan.generalTasks && workPlan.generalTasks.length > 0 && (
                <div className="mb-3">
                  <h4 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1">
                    <i className="fas fa-globe text-blue-600"></i>
                    משימות כלליות
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {workPlan.generalTasks.map((task: string, index: number) => (
                      <span key={index} className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium flex items-center gap-1">
                        <i className="fas fa-check-circle text-xs"></i>
                        {task}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              
              {workPlan.shiftTasks && (
                <div>
                  <h4 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1">
                    <i className="fas fa-clock text-teal-600"></i>
                    משימות לפי משמרות
                  </h4>
                  <div className="space-y-2">
                    {SHIFT_TYPES.map((shift) => {
                      const tasks = workPlan.shiftTasks?.[shift.key as keyof typeof workPlan.shiftTasks] || []
                      if (tasks.length === 0) return null
                      
                      return (
                        <div key={shift.key} className="bg-white rounded-lg p-3 border border-teal-200">
                          <div className="text-sm font-medium mb-2 flex items-center gap-2">
                            <span className="text-lg">{shift.icon}</span>
                            {shift.name}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {tasks.map((task: string, index: number) => (
                              <span key={index} className="bg-teal-100 text-teal-800 px-2 py-1 rounded-full text-xs font-medium flex items-center gap-1">
                                <i className="fas fa-list-ul text-xs"></i>
                                {task}
                              </span>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Shifts Assignment */}
          <div className="space-y-4">
            {SHIFT_TYPES.map((shift) => {
              const assignments = getShiftAssignments(shift.name)
              const groupedEmployees = assignments.reduce((acc: { [key: string]: any[] }, employeeId) => {
                const employee = getEmployeeById(employeeId)
                if (employee) {
                  const category = getCategoryByRole(employee.role)
                  if (!acc[category]) {
                    acc[category] = []
                  }
                  acc[category].push(employee)
                }
                return acc
              }, {})

              const shiftTasks = workPlan?.shiftTasks?.[shift.key as keyof typeof workPlan.shiftTasks] || []

              return (
                <div key={shift.key} className="bg-white border-2 border-slate-200 rounded-xl p-4 hover:border-teal-300 transition-colors">
                  <div className="flex justify-between items-center mb-3">
                    <h3 className="font-semibold text-slate-800 flex items-center gap-2 text-lg">
                      <span className="text-2xl">{shift.icon}</span>
                      {shift.name}
                    </h3>
                    <div className="flex items-center gap-2">
                      <div className="text-sm text-slate-600 bg-slate-100 px-3 py-1 rounded-full">
                        {assignments.length} עובדים
                      </div>
                      <button
                        onClick={() => openEmployeeSelector(shift.name)}
                        className="bg-teal-600 hover:bg-teal-700 text-white py-2 px-4 rounded-lg text-sm font-medium transition-colors flex items-center gap-1"
                      >
                        <i className="fas fa-plus"></i>
                        הוסף עובד
                      </button>
                    </div>
                  </div>

                  {/* Tasks for this shift */}
                  {shiftTasks.length > 0 && (
                    <div className="mb-3 p-3 bg-teal-50 rounded-lg border border-teal-200">
                      <h4 className="text-sm font-semibold text-teal-800 mb-2 flex items-center gap-1">
                        <i className="fas fa-tasks"></i>
                        משימות למשמרת
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {shiftTasks.map((task: string, index: number) => (
                          <div key={index} className="flex items-center gap-2 bg-teal-100 text-teal-800 px-3 py-2 rounded-full text-sm font-medium">
                            <span>{task}</span>
                            <button
                              onClick={() => openEmployeeSelector(shift.name, [task])}
                              className="bg-teal-600 hover:bg-teal-700 text-white px-2 py-1 rounded-full text-xs transition-colors"
                              title={`הוסף עובד למשימה: ${task}`}
                            >
                              <i className="fas fa-user-plus"></i>
                            </button>
                          </div>
                        ))}
                        {shiftTasks.length > 1 && (
                          <button
                            onClick={() => openEmployeeSelector(shift.name, shiftTasks.slice(0, 2))}
                            className="flex items-center gap-2 bg-blue-100 text-blue-800 px-3 py-2 rounded-full text-sm font-medium hover:bg-blue-200 transition-colors"
                            title="הוסף עובד ל-2 משימות ראשונות"
                          >
                            <i className="fas fa-tasks"></i>
                            <span>2 משימות</span>
                            <i className="fas fa-user-plus"></i>
                          </button>
                        )}
                        {shiftTasks.length > 2 && (
                          <button
                            onClick={() => openEmployeeSelector(shift.name, shiftTasks.slice(0, 3))}
                            className="flex items-center gap-2 bg-indigo-100 text-indigo-800 px-3 py-2 rounded-full text-sm font-medium hover:bg-indigo-200 transition-colors"
                            title="הוסף עובד ל-3 משימות ראשונות"
                          >
                            <i className="fas fa-tasks"></i>
                            <span>3 משימות</span>
                            <i className="fas fa-user-plus"></i>
                          </button>
                        )}
                        {shiftTasks.length > 1 && (
                          <button
                            onClick={() => openEmployeeSelector(shift.name, shiftTasks)}
                            className="flex items-center gap-2 bg-purple-100 text-purple-800 px-3 py-2 rounded-full text-sm font-medium hover:bg-purple-200 transition-colors"
                            title="הוסף עובד לכל המשימות"
                          >
                            <i className="fas fa-tasks"></i>
                            <span>כל המשימות</span>
                            <i className="fas fa-user-plus"></i>
                          </button>
                        )}
                        <button
                          onClick={() => openTaskSelector(shift.name)}
                          className="flex items-center gap-2 bg-gray-100 text-gray-800 px-3 py-2 rounded-full text-sm font-medium hover:bg-gray-200 transition-colors"
                          title="בחר משימות מותאמות אישית"
                        >
                          <i className="fas fa-cog"></i>
                          <span>בחר משימות</span>
                          <i className="fas fa-user-plus"></i>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Assigned Employees */}
                  <div className="space-y-3">
                    {Object.keys(groupedEmployees).length === 0 ? (
                      <div className="text-center text-slate-400 py-8 bg-slate-50 rounded-lg">
                        <i className="fas fa-user-plus text-4xl mb-3 text-slate-300"></i>
                        <p className="text-sm font-medium">אין עובדים משובצים למשמרת זו</p>
                        <p className="text-xs text-slate-500 mt-1">לחץ על "הוסף עובד" כדי להתחיל</p>
                      </div>
                    ) : (
                      Object.entries(groupedEmployees).map(([category, employees]) => (
                        <div key={category}>
                          <div className="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1">
                            <i className="fas fa-tag"></i>
                            {category}
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                            {employees.map((employee) => {
                              const employeeTasks = getEmployeeTasks(employee.id, shift.name)
                              return (
                                <div
                                  key={employee.id}
                                  className="bg-gradient-to-r from-blue-50 to-teal-50 text-slate-800 px-3 py-2 rounded-lg text-sm font-medium flex items-center justify-between border border-blue-200 hover:border-teal-300 transition-colors"
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="text-lg">{getRoleIcon(employee.role)}</span>
                                    <div>
                                      <span className="font-medium">{employee.name}</span>
                                      {employeeTasks.length > 0 && (
                                        <div className="flex flex-wrap gap-1 mt-1">
                                          {employeeTasks.map((task, index) => (
                                            <span key={index} className="bg-teal-100 text-teal-700 px-1 py-0.5 rounded text-xs">
                                              {task}
                                            </span>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  <button
                                    onClick={() => handleRemoveEmployee(employee.id, shift.name)}
                                    className="text-red-500 hover:text-red-700 hover:bg-red-50 rounded-full p-1 transition-colors"
                                  >
                                    <i className="fas fa-times text-xs"></i>
                                  </button>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Employee Selection Modal */}
        {showEmployeeSelector && selectedShift && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[10002] p-4">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                  <i className="fas fa-user-plus text-teal-600"></i>
                  בחר עובד למשמרת {selectedShift}
                </h3>
                <button
                  onClick={() => setShowEmployeeSelector(false)}
                  className="text-slate-400 hover:text-slate-600 text-2xl"
                >
                  <i className="fas fa-times"></i>
                </button>
              </div>

              {selectedTasks.length > 0 && (
                <div className="mb-4 p-3 bg-teal-50 rounded-lg border border-teal-200">
                  <p className="text-sm font-medium text-teal-800 mb-2">
                    <i className="fas fa-tasks mr-2"></i>
                    משימות נבחרות:
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {selectedTasks.map((task, index) => (
                      <span key={index} className="bg-teal-100 text-teal-800 px-2 py-1 rounded-full text-xs">
                        {task}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {getAvailableEmployees(selectedShift).length === 0 ? (
                  <div className="text-center text-slate-400 py-8">
                    <i className="fas fa-users text-4xl mb-3 text-slate-300"></i>
                    <p className="text-sm font-medium">כל העובדים כבר משובצים למשמרת זו</p>
                  </div>
                ) : (
                  getAvailableEmployees(selectedShift).map((employee) => (
                    <div
                      key={employee.id}
                      className="bg-gradient-to-r from-blue-50 to-teal-50 border border-blue-200 rounded-lg p-4 hover:border-teal-300 transition-colors cursor-pointer"
                      onClick={() => handleAssignEmployee(employee.id, selectedShift, selectedTasks.length > 0 ? selectedTasks : undefined)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="icon icon-secondary">
                            <i className="fas fa-user text-lg"></i>
                          </div>
                          <div>
                            <h4 className="font-semibold text-slate-800 flex items-center gap-2">
                              {getRoleIcon(employee.role)} {employee.name}
                            </h4>
                            <p className="text-sm text-slate-600">{employee.role}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-slate-500 mb-1">
                            {getCategoryByRole(employee.role)}
                          </div>
                          <button className="bg-teal-600 hover:bg-teal-700 text-white px-3 py-1 rounded-lg text-sm font-medium transition-colors">
                            <i className="fas fa-plus mr-1"></i>
                            הוסף
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-slate-200">
                <Button 
                  onClick={() => setShowEmployeeSelector(false)} 
                  variant="outline" 
                  className="bg-slate-100 hover:bg-slate-200"
                >
                  ביטול
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Task Selection Modal */}
        {showTaskSelector && selectedShift && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[10002] p-4">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                  <i className="fas fa-tasks text-teal-600"></i>
                  בחר משימות למשמרת {selectedShift}
                </h3>
                <button
                  onClick={() => setShowTaskSelector(false)}
                  className="text-slate-400 hover:text-slate-600 text-2xl"
                >
                  <i className="fas fa-times"></i>
                </button>
              </div>

              <div className="mb-4">
                <p className="text-sm text-slate-600 mb-3">
                  בחר עד 3 משימות לעובד:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {getWorkPlanForDate(selectedDate)?.generalTasks?.map((task: string, index: number) => (
                    <label key={index} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedTasks.includes(task)}
                        onChange={(e) => {
                          if (e.target.checked && selectedTasks.length < 3) {
                            setSelectedTasks([...selectedTasks, task])
                          } else if (!e.target.checked) {
                            setSelectedTasks(selectedTasks.filter(t => t !== task))
                          }
                        }}
                        className="w-4 h-4 text-teal-600 border-gray-300 rounded focus:ring-teal-500"
                      />
                      <span className="text-sm font-medium text-gray-800">{task}</span>
                    </label>
                  ))}
                </div>
              </div>

              {selectedTasks.length > 0 && (
                <div className="mb-4 p-3 bg-teal-50 rounded-lg border border-teal-200">
                  <p className="text-sm font-medium text-teal-800 mb-2">
                    <i className="fas fa-check-circle mr-2"></i>
                    משימות נבחרות ({selectedTasks.length}/3):
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {selectedTasks.map((task, index) => (
                      <span key={index} className="bg-teal-100 text-teal-800 px-2 py-1 rounded-full text-xs">
                        {task}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button 
                  onClick={() => setShowTaskSelector(false)} 
                  variant="outline" 
                  className="bg-gray-100 hover:bg-gray-200"
                >
                  ביטול
                </Button>
                <Button 
                  onClick={() => {
                    setShowTaskSelector(false)
                    setShowEmployeeSelector(true)
                  }}
                  disabled={selectedTasks.length === 0}
                  className="bg-teal-600 hover:bg-teal-700"
                >
                  המשך לבחירת עובד
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-slate-200">
          <Button onClick={closeModal} variant="outline" className="bg-slate-100 hover:bg-slate-200">
            <i className="fas fa-times mr-2"></i>
            סגור
          </Button>
        </div>
      </div>
    </div>
  )
}
