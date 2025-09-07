'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useModalStore } from '@/store/modal-store'
import { useEmployeesStore } from '@/store/employees-store'
import { useScheduleStore } from '@/store/schedule-store'
import { useWorkPlanStore } from '@/store/work-plan-store'
import { useLoadingStore } from '@/store/loading-store'

export function AssignmentModal() {
  const { activeModal, modalData, closeModal, openModal } = useModalStore()
  const { employees } = useEmployeesStore()
  const { assignShift, shifts, clearShift, removeEmployeeFromShift } = useScheduleStore()
  const { workPlans } = useWorkPlanStore()
  const { setLoading } = useLoadingStore()
  
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null)
  const [assignmentNote, setAssignmentNote] = useState('')
  const [selectedActivities, setSelectedActivities] = useState<string[]>([])
  const [isGeneralAssignment, setIsGeneralAssignment] = useState(false)

  if (activeModal !== 'assignment') return null

  // Handle both old format (shiftKey) and new format (date + shiftType)
  let shiftKey: string
  let date: Date
  let shiftType: string
  
  if (modalData && typeof modalData === 'object' && 'date' in modalData && 'shiftType' in modalData) {
    // New format from vertical schedule
    shiftKey = `${modalData.date}-${modalData.shiftType}`
    date = new Date(modalData.date)
    shiftType = modalData.shiftType
  } else {
    // Old format from grid schedule
    shiftKey = modalData as string
    const [year, month, day, ...shiftTypeParts] = shiftKey.split('-')
    shiftType = shiftTypeParts.join(' ')
    date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
  }
  
  const daysOfWeek = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
  const dayName = daysOfWeek[date.getDay()]

  // Get available activities for this day and shift
  const getAvailableActivities = () => {
    const dateString = modalData.date || `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    const workPlan = workPlans[dateString]
    
    if (!workPlan) return []
    
    // Get general activities
    const generalActivities = workPlan.generalTasks || []
    
    // Get shift-specific activities
    const shiftKey = shiftType === 'משמרת בוקר' ? 'morning' : 
                    shiftType === 'משמרת צהריים' ? 'afternoon' : 'evening'
    const shiftActivities = workPlan.shiftTasks?.[shiftKey] || []
    
    // Combine and remove duplicates
    return [...new Set([...generalActivities, ...shiftActivities])]
  }

  const availableActivities = getAvailableActivities()

  const handleActivityToggle = (activity: string) => {
    setSelectedActivities(prev => 
      prev.includes(activity) 
        ? prev.filter(a => a !== activity)
        : [...prev, activity]
    )
  }

  const handleAssignmentAction = async (action: string, isDayAction = false) => {
    if (!selectedEmployeeId) {
      alert('יש לבחור עובד תחילה.')
      return
    }

    setLoading(true)
    try {
      const assignmentData = {
        employeeId: selectedEmployeeId,
        status: isDayAction ? action : (action === 'regular' ? null : action),
        note: assignmentNote,
        activities: selectedActivities,
        isGeneral: isGeneralAssignment
      }
      
      await assignShift(shiftKey, selectedEmployeeId, assignmentData.status || undefined, assignmentData.note || undefined)
      closeModal()
    } catch (error) {
      console.error('Error assigning shift:', error)
    } finally {
      setLoading(false)
    }
  }

  const getRoleIcon = (role: string) => {
    if (['קמ"ן', 'קמ"ן א', 'קמ"ן ב', 'קמב"ל', 'קמב"צ'].includes(role)) return '⭐️'
    if (role === 'ראש צוות') return '⭐'
    return ''
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[10001] p-2 sm:p-4 animate-in fade-in-0 duration-300">
      <div className="modal-content bg-white rounded-2xl shadow-2xl p-4 sm:p-6 w-full max-w-3xl max-h-[95vh] sm:max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-300">
        <div className="flex justify-between items-center mb-4 border-b border-slate-200 pb-3 sm:pb-4">
          <div className="flex items-center gap-2 sm:gap-3">
            <div 
              onClick={closeModal}
              className="modal-icon-close w-8 h-8 sm:w-10 sm:h-10 bg-indigo-100 rounded-full flex items-center justify-center"
            >
              <i className="fas fa-user-plus text-indigo-600 text-base sm:text-lg"></i>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-700">
              שיבוץ ל{dayName}, {shiftType}
            </h2>
          </div>
          <button
            onClick={closeModal}
            className="w-8 h-8 sm:w-10 sm:h-10 bg-slate-100 hover:bg-slate-200 rounded-full flex items-center justify-center text-slate-600 hover:text-slate-800 transition-all duration-200 text-sm sm:text-lg"
            title="סגור"
          >
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Already Assigned */}
          <div>
            <h3 className="font-semibold mb-2 text-lg text-slate-600">משובצים כעת</h3>
            <div className="h-64 overflow-y-auto border rounded-lg p-2 space-y-2 bg-slate-50">
              {(() => {
                const shiftData = shifts[shiftKey]
                if (shiftData && shiftData.assignments && shiftData.assignments.length > 0) {
                                     return shiftData.assignments.map((assignment: any) => {
                     const employee = employees.find((e: any) => e.id === assignment.employeeId)
                     if (!employee) return null
                     
                     let statusText = assignment.status ? ` (${assignment.status})` : ''
                     return (
                       <div key={assignment.employeeId} className="p-2 rounded-lg text-sm bg-slate-700 text-slate-100 relative group">
                         <button
                           onClick={() => removeEmployeeFromShift(shiftKey, assignment.employeeId)}
                           className="absolute top-1 left-1 text-red-300 hover:text-red-100 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                           title="הסר עובד"
                         >
                           ×
                         </button>
                         <span className="font-semibold">{employee.name}</span>{statusText}
                       </div>
                     )
                   })
                } else {
                  return <p className="text-slate-500 text-center p-4">אין עובדים משובצים</p>
                }
              })()}
            </div>
          </div>

          {/* Employee Selection */}
          <div>
            <h3 className="font-semibold mb-2 text-lg text-slate-600">1. בחר עובד להוספה</h3>
            <div className="h-64 overflow-y-auto border rounded-lg p-2 space-y-2">
              {employees.map((emp) => (
                <div
                  key={emp.id}
                  className={`employee-list-item p-3 rounded-lg flex items-center justify-between cursor-pointer hover:bg-slate-100 ${
                    selectedEmployeeId === emp.id ? 'bg-blue-100 border-r-4 border-blue-500' : ''
                  }`}
                  onClick={() => setSelectedEmployeeId(emp.id)}
                >
                  <div className="flex items-center">
                    <span className="mr-2">{getRoleIcon(emp.role)}</span>
                    <div>
                      <p className="font-bold">{emp.name}</p>
                      <p className="text-sm text-slate-600">{emp.role}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Activity Selection */}
          {selectedEmployeeId && (
            <div>
              <h3 className="font-semibold mb-2 text-lg text-slate-600">2. בחר פעילויות</h3>
              
              {/* General Assignment Option */}
              <div className="mb-4">
                <label className="flex items-center space-x-2 space-x-reverse">
                  <input
                    type="checkbox"
                    checked={isGeneralAssignment}
                    onChange={(e) => setIsGeneralAssignment(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-sm font-medium">שיבוץ כללי (ללא קישור לפעילות ספציפית)</span>
                </label>
              </div>

              {/* Activity Selection */}
              {!isGeneralAssignment && availableActivities.length > 0 && (
                <div className="mb-4">
                  <Label className="text-sm font-medium">פעילויות זמינות ל{shiftType}:</Label>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    {availableActivities.map((activity) => (
                      <label key={activity} className="flex items-center space-x-2 space-x-reverse">
                        <input
                          type="checkbox"
                          checked={selectedActivities.includes(activity)}
                          onChange={() => handleActivityToggle(activity)}
                          className="rounded"
                        />
                        <span className="text-sm">{activity}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Selected Activities Display */}
              {!isGeneralAssignment && selectedActivities.length > 0 && (
                <div className="mb-4">
                  <Label className="text-sm font-medium">פעילויות נבחרות:</Label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {selectedActivities.map((activity) => (
                      <span 
                        key={activity}
                        className="bg-green-100 text-green-800 px-2 py-1 rounded-full text-sm flex items-center gap-1"
                      >
                        {activity}
                        <button
                          type="button"
                          onClick={() => handleActivityToggle(activity)}
                          className="text-green-600 hover:text-green-800"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {!isGeneralAssignment && availableActivities.length === 0 && (
                <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <p className="text-sm text-yellow-800">
                    אין פעילויות מוגדרות ל{shiftType} ביום זה. 
                    <button 
                      onClick={() => openModal('work-plan', { date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` })}
                      className="text-yellow-600 hover:text-yellow-800 underline mr-1"
                    >
                      הוסף תכנון עבודה
                    </button>
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Action Selection */}
          <div>
            <h3 className="font-semibold mb-2 text-lg text-slate-600">3. בחר פעולה</h3>
            <div className="space-y-2 flex flex-col">
              <Button
                onClick={() => handleAssignmentAction('regular')}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg w-full text-right"
              >
                <i className="fas fa-check ml-2"></i>שבץ כרגיל
              </Button>
              <Button
                onClick={() => handleAssignmentAction('תגבור')}
                className="bg-sky-500 hover:bg-sky-600 text-white font-bold py-2 px-4 rounded-lg w-full text-right"
              >
                <i className="fas fa-plus ml-2"></i>שבץ כתגבור
              </Button>
              <Button
                onClick={() => handleAssignmentAction('כוננות')}
                className="bg-amber-500 hover:bg-amber-600 text-white font-bold py-2 px-4 rounded-lg w-full text-right"
              >
                <i className="fas fa-phone ml-2"></i>שבץ ככוננות
              </Button>
              
              <hr className="my-2" />
              
              <Button
                onClick={() => handleAssignmentAction('חופשה', true)}
                className="bg-cyan-500 hover:bg-cyan-600 text-white font-bold py-2 px-4 rounded-lg w-full text-right"
              >
                <i className="fas fa-plane ml-2"></i>קבע חופשה (כל היום)
              </Button>
              <Button
                onClick={() => handleAssignmentAction('מילואים', true)}
                className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-lg w-full text-right"
              >
                <i className="fas fa-star-of-david ml-2"></i>קבע מילואים (כל היום)
              </Button>
              <Button
                onClick={() => handleAssignmentAction('מחלה', true)}
                className="bg-orange-400 hover:bg-orange-500 text-white font-bold py-2 px-4 rounded-lg w-full text-right"
              >
                <i className="fas fa-notes-medical ml-2"></i>קבע מחלה (כל היום)
              </Button>
              <Button
                onClick={() => handleAssignmentAction('לימודים', true)}
                className="bg-purple-500 hover:bg-purple-600 text-white font-bold py-2 px-4 rounded-lg w-full text-right"
              >
                <i className="fas fa-graduation-cap ml-2"></i>קבע לימודים (כל היום)
              </Button>
              <Button
                onClick={() => handleAssignmentAction('קורס', true)}
                className="bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-lg w-full text-right"
              >
                <i className="fas fa-chalkboard-teacher ml-2"></i>קבע קורס (כל היום)
              </Button>
            </div>
            
            <div className="mt-4">
              <Label htmlFor="assignment-note" className="block text-sm font-medium text-slate-600">
                הערה למשמרת
              </Label>
              <Input
                id="assignment-note"
                type="text"
                placeholder="לדוגמה: מגיע באיחור"
                value={assignmentNote}
                onChange={(e) => setAssignmentNote(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-between items-center">
          <Button
            onClick={async () => {
              setLoading(true)
              try {
                await clearShift(shiftKey)
                closeModal()
              } catch (error) {
                console.error('Error clearing shift:', error)
              } finally {
                setLoading(false)
              }
            }}
            variant="destructive"
            className="text-red-500 hover:text-red-700"
          >
            <i className="fas fa-trash-alt ml-2"></i>הסר את כל השיבוצים
          </Button>
          <Button
            onClick={closeModal}
            variant="outline"
          >
            חזור
          </Button>
        </div>
      </div>
    </div>
  )
}
