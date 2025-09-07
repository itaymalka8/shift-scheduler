'use client'

import { useScheduleStore } from '@/store/schedule-store'
import { useEmployeesStore } from '@/store/employees-store'

export function GanttChart() {
  const { currentWeekOffset, shifts } = useScheduleStore()
  const { employees } = useEmployeesStore()

  // Calculate week dates
  const getSunday = (d: Date) => {
    d = new Date(d)
    const day = d.getDay()
    const diff = d.getDate() - day
    return new Date(d.setDate(diff))
  }
  
  const sunday = getSunday(new Date(new Date().setDate(new Date().getDate() + currentWeekOffset * 7)))
  const weekStart = new Date(sunday)
  
  const formatDate = (date: Date) => {
    return date.toLocaleString('he-IL', { day: '2-digit', month: '2-digit' })
  }
  
  const getDateString = (date: Date) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
  
  const daysOfWeek = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
  const shiftTypes = ['morning', 'afternoon', 'evening']
  const shiftNames = ['בוקר', 'צהריים', 'ערב']
  
  // Get all employees with assignments
  const employeesWithAssignments = employees.filter(emp => {
    return Object.values(shifts).some(shift => 
      shift.assignments.some(assignment => assignment.employeeId === emp.id)
    )
  })
  
  return (
    <div className="gantt-container">
      {/* Header */}
      <div className="gantt-header grid grid-cols-8 gap-1 mb-2">
        <div className="gantt-cell-header bg-slate-200 p-2 text-center font-semibold text-sm">
          עובד
        </div>
        {daysOfWeek.map((day, index) => {
          const currentDate = new Date(weekStart)
          currentDate.setDate(weekStart.getDate() + index)
          return (
            <div key={index} className="gantt-cell-header bg-slate-200 p-2 text-center font-semibold text-sm">
              <div>{day}</div>
              <div className="text-xs text-slate-600">{formatDate(currentDate)}</div>
            </div>
          )
        })}
      </div>
      
      {/* Rows */}
      <div className="gantt-body">
        {employeesWithAssignments.map((employee) => (
          <div key={employee.id} className="gantt-row grid grid-cols-8 gap-1 mb-1">
            {/* Employee name */}
            <div className="gantt-cell bg-slate-100 p-2 text-sm font-medium border-r border-slate-300">
              <div className="truncate">{employee.name}</div>
              <div className="text-xs text-slate-600">{employee.role}</div>
            </div>
            
            {/* Days */}
            {daysOfWeek.map((_, dayIndex) => {
              const currentDate = new Date(weekStart)
              currentDate.setDate(weekStart.getDate() + dayIndex)
              const dateStr = getDateString(currentDate)
              
              return (
                <div key={dayIndex} className="gantt-cell bg-white border border-slate-200 p-1">
                  <div className="space-y-1">
                    {shiftTypes.map((shiftType, shiftIndex) => {
                      const shiftKey = `${dateStr}-${shiftType}`
                      const shiftData = shifts[shiftKey]
                      const assignment = shiftData?.assignments.find(a => a.employeeId === employee.id)
                      
                      if (assignment) {
                        return (
                          <div 
                            key={shiftIndex}
                            className={`gantt-bar text-xs p-1 rounded text-white text-center ${
                              shiftType === 'morning' ? 'bg-yellow-500' :
                              shiftType === 'afternoon' ? 'bg-orange-500' :
                              'bg-blue-500'
                            }`}
                            title={`${shiftNames[shiftIndex]}: ${assignment.tasks?.join(', ') || 'ללא משימות'}`}
                          >
                            {shiftNames[shiftIndex]}
                            {assignment.tasks && assignment.tasks.length > 0 && (
                              <div className="text-xs opacity-75">
                                {assignment.tasks.length} משימות
                              </div>
                            )}
                          </div>
                        )
                      }
                      
                      return (
                        <div 
                          key={shiftIndex}
                          className="gantt-empty text-xs text-slate-400 text-center py-1"
                        >
                          -
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
      
      {/* Legend */}
      <div className="mt-4 flex gap-4 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-yellow-500 rounded"></div>
          <span>משמרת בוקר</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-orange-500 rounded"></div>
          <span>משמרת צהריים</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-blue-500 rounded"></div>
          <span>משמרת ערב</span>
        </div>
      </div>
    </div>
  )
}

