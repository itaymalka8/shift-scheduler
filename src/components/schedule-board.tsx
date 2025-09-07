'use client'

import { useState, useRef } from 'react'
import { useScheduleStore } from '@/store/schedule-store'
import { useEmployeesStore } from '@/store/employees-store'
import { useModalStore } from '@/store/modal-store'

export function ScheduleBoard() {
  const { currentWeekOffset, shifts, changeWeek, removeEmployeeFromShift, assignShift } = useScheduleStore()
  const { employees } = useEmployeesStore()
  const { openModal } = useModalStore()
  
  const [draggedAssignment, setDraggedAssignment] = useState<any>(null)
  const [dragOverShift, setDragOverShift] = useState<string | null>(null)
  const [dragOverEmployee, setDragOverEmployee] = useState<string | null>(null)

  const daysOfWeek = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
  const shiftTypes = ['משמרת בוקר', 'משמרת צהריים', 'משמרת ערב']

  const getSunday = (d: Date) => {
    d = new Date(d)
    const day = d.getDay()
    const diff = d.getDate() - day
    return new Date(d.setDate(diff))
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
    
    for (const category in categoryMapping) {
      if (categoryMapping[category as keyof typeof categoryMapping].includes(role)) {
        return category
      }
    }
    return 'הערכה/אחר'
  }

  const categoryOrder = ['פיקוד', 'רכז', 'בילוש', 'הערכה/אחר']

  const sunday = getSunday(new Date(new Date().setDate(new Date().getDate() + currentWeekOffset * 7)))

  const handleDragStart = (e: React.DragEvent, assignment: any, sourceShiftKey: string) => {
    setDraggedAssignment({ ...assignment, sourceShiftKey })
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent, shiftKey: string) => {
    e.preventDefault()
    setDragOverShift(shiftKey)
  }

  const handleDragLeave = () => {
    setDragOverShift(null)
    setDragOverEmployee(null)
  }

  const handleDrop = async (e: React.DragEvent, targetShiftKey: string) => {
    e.preventDefault()
    setDragOverShift(null)
    setDragOverEmployee(null)
    
    if (!draggedAssignment || draggedAssignment.sourceShiftKey === targetShiftKey) {
      setDraggedAssignment(null)
      return
    }

    try {
      // Check if employee is already assigned to target shift
      const targetShiftData = shifts[targetShiftKey]
      const isAlreadyAssigned = targetShiftData?.assignments?.some(
        (assignment: any) => assignment.employeeId === draggedAssignment.employeeId
      )
      
      if (isAlreadyAssigned) {
        // If already assigned, just remove from source
        await removeEmployeeFromShift(draggedAssignment.sourceShiftKey, draggedAssignment.employeeId)
      } else {
        // Remove from source shift and add to target shift
        await removeEmployeeFromShift(draggedAssignment.sourceShiftKey, draggedAssignment.employeeId)
        await assignShift(targetShiftKey, draggedAssignment.employeeId, draggedAssignment.status, draggedAssignment.note)
      }
    } catch (error) {
      console.error('Error moving assignment:', error)
    } finally {
      setDraggedAssignment(null)
    }
  }

  const handleEmployeeDrop = async (e: React.DragEvent, targetEmployeeId: string, targetShiftKey: string) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverEmployee(null)
    
    if (!draggedAssignment || draggedAssignment.employeeId === targetEmployeeId) {
      setDraggedAssignment(null)
      return
    }

    try {
      // Get target employee data
      const targetShiftData = shifts[targetShiftKey]
      const targetAssignment = targetShiftData?.assignments?.find(
        (assignment: any) => assignment.employeeId === targetEmployeeId
      )
      
      if (!targetAssignment) {
        setDraggedAssignment(null)
        return
      }

      // Swap the two employees
      const sourceShiftKey = draggedAssignment.sourceShiftKey
      
      // Remove both employees from their current positions
      await removeEmployeeFromShift(sourceShiftKey, draggedAssignment.employeeId)
      await removeEmployeeFromShift(targetShiftKey, targetEmployeeId)
      
      // Add them to their new positions
      await assignShift(targetShiftKey, draggedAssignment.employeeId, draggedAssignment.status, draggedAssignment.note)
      await assignShift(sourceShiftKey, targetEmployeeId, targetAssignment.status, targetAssignment.note)
      
    } catch (error) {
      console.error('Error swapping employees:', error)
    } finally {
      setDraggedAssignment(null)
    }
  }

  return (
    <div className="bg-white p-4 rounded-xl shadow-lg overflow-x-auto">
      <div className="schedule-grid grid grid-cols-7 gap-2 min-w-[1000px] overflow-x-auto">
        {/* Day Headers */}
        {daysOfWeek.map((day, index) => {
          const currentDate = new Date(sunday)
          currentDate.setDate(sunday.getDate() + index)

          return (
            <div
              key={day}
              className="day-header text-center p-2 bg-teal-500 text-white rounded-t-lg flex flex-col leading-tight cursor-pointer"
              onClick={() => openModal('daily-summary', index)}
            >
              <span className="font-bold">{day}</span>
              <span className="text-xs font-medium">{formatDate(currentDate)}</span>
            </div>
          )
        })}

        {/* Schedule Grid */}
        {Array.from({ length: 7 }).map((_, dayIndex) => {
          const currentDate = new Date(sunday)
          currentDate.setDate(sunday.getDate() + dayIndex)
          const dateStr = getDateString(currentDate)

          return (
            <div key={dayIndex} className="flex flex-col gap-2">
              {shiftTypes.map((type) => {
                const shiftKey = `${dateStr}-${type}`
                const shiftData = shifts[shiftKey]

                return (
                  <div
                    key={shiftKey}
                    className={`shift-slot bg-slate-50 border border-dashed border-slate-300 rounded-lg p-2 flex flex-col justify-start gap-1 min-h-[90px] cursor-pointer hover:bg-slate-100 transition-colors ${
                      dragOverShift === shiftKey ? 'drag-over' : ''
                    }`}
                    onClick={() => openModal('assignment', shiftKey)}
                    onDragOver={(e) => handleDragOver(e, shiftKey)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, shiftKey)}
                  >
                    <span className="text-xs text-slate-500">{type}</span>
                    
                    {shiftData?.assignments && shiftData.assignments.length > 0 && (
                      <ShiftAssignments
                        assignments={shiftData.assignments}
                        employees={employees}
                        shiftKey={shiftKey}
                        getRoleIcon={getRoleIcon}
                        getCategoryByRole={getCategoryByRole}
                        categoryOrder={categoryOrder}
                        onDragStart={handleDragStart}
                        draggedAssignment={draggedAssignment}
                        dragOverEmployee={dragOverEmployee}
                        setDragOverEmployee={setDragOverEmployee}
                        onEmployeeDrop={handleEmployeeDrop}
                      />
                    )}
                  </div>
                )
              })}

              {/* Daily Summary Footer */}
              <DailySummary dateStr={dateStr} shifts={shifts} employees={employees} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ShiftAssignments({ 
  assignments, 
  employees, 
  shiftKey, 
  getRoleIcon, 
  getCategoryByRole, 
  categoryOrder,
  onDragStart,
  draggedAssignment,
  dragOverEmployee,
  setDragOverEmployee,
  onEmployeeDrop
}: any) {
  const { removeEmployeeFromShift } = useScheduleStore()
  const groupedAssignments: any = {}
  
  assignments.forEach((assignment: any) => {
    const employee = employees.find((e: any) => e.id === assignment.employeeId)
    if (employee) {
      const category = getCategoryByRole(employee.role)
      if (!groupedAssignments[category]) {
        groupedAssignments[category] = []
      }
      groupedAssignments[category].push(assignment)
    }
  })

  return (
    <>
      {categoryOrder.map((category: string) => {
        if (groupedAssignments[category] && groupedAssignments[category].length > 0) {
          return (
            <div key={category}>
              <div className="font-bold text-xs text-slate-500 mt-2 border-b border-slate-200 category-header">
                {category}
              </div>
              {groupedAssignments[category].map((assignment: any) => {
                const employee = employees.find((e: any) => e.id === assignment.employeeId)
                if (!employee) return null

                let statusText = ''
                let bgColor = 'bg-slate-700'
                
                if (assignment.status) {
                  statusText = ` - ${assignment.status}`
                  switch(assignment.status) {
                    case 'כוננות': bgColor = 'bg-yellow-400'; break
                    case 'תגבור': bgColor = 'bg-sky-400'; break
                    case 'חופשה': bgColor = 'bg-cyan-400'; break
                    case 'מילואים': bgColor = 'bg-green-400'; break
                    case 'מחלה': bgColor = 'bg-orange-400'; break
                    case 'לימודים': bgColor = 'bg-purple-400'; break
                    case 'קורס': bgColor = 'bg-gray-400'; break
                  }
                }

                const roleIcon = getRoleIcon(employee.role)
                const isDragging = draggedAssignment && 
                  draggedAssignment.employeeId === assignment.employeeId && 
                  draggedAssignment.sourceShiftKey === shiftKey

                return (
                  <div
                    key={assignment.employeeId}
                    className={`assigned-employee mt-1 p-1.5 rounded-md text-xs relative text-center flex items-center justify-center ${bgColor} text-slate-100 group cursor-grab ${
                      isDragging ? 'opacity-50' : ''
                    } ${
                      dragOverEmployee === assignment.employeeId ? 'drag-over' : ''
                    }`}
                    draggable
                    onDragStart={(e) => onDragStart(e, assignment, shiftKey)}
                    onDragOver={(e) => {
                      e.preventDefault()
                      if (draggedAssignment && draggedAssignment.employeeId !== assignment.employeeId) {
                        setDragOverEmployee(assignment.employeeId)
                      }
                    }}
                    onDragLeave={() => setDragOverEmployee(null)}
                    onDrop={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setDragOverEmployee(null)
                      
                      if (draggedAssignment && draggedAssignment.employeeId !== assignment.employeeId) {
                        onEmployeeDrop(e, assignment.employeeId, shiftKey)
                      }
                    }}
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        removeEmployeeFromShift(shiftKey, assignment.employeeId)
                      }}
                      className="delete-assignment-btn group-hover:opacity-100"
                      title="הסר עובד"
                    >
                      ×
                    </button>
                    {assignment.note && (
                      <i className="fas fa-info-circle text-blue-400 ml-1" title={assignment.note}></i>
                    )}
                    {roleIcon}
                    <span className="font-semibold">{employee.name}</span>
                    {statusText && <span className="font-light">{statusText}</span>}
                  </div>
                )
              })}
            </div>
          )
        }
        return null
      })}
    </>
  )
}

function DailySummary({ dateStr, shifts, employees }: any) {
  const shiftTypes = ['משמרת בוקר', 'משמרת צהריים', 'משמרת ערב']
  const notWorkingStatuses = ['חופשה', 'מילואים', 'מחלה', 'תגבור', 'לימודים', 'קורס']
  
  let morningCount = 0, afternoonCount = 0, eveningCount = 0
  const notWorkingIds = new Set()

  shiftTypes.forEach(type => {
    const shiftKey = `${dateStr}-${type}`
    const shiftData = shifts[shiftKey]
    if (shiftData && shiftData.assignments) {
      shiftData.assignments.forEach((assignment: any) => {
        if (notWorkingStatuses.includes(assignment.status)) {
          notWorkingIds.add(assignment.employeeId)
        } else if (!assignment.status) {
          if (type === 'משמרת בוקר') morningCount++
          else if (type === 'משמרת צהריים') afternoonCount++
          else if (type === 'משמרת ערב') eveningCount++
        }
      })
    }
  })

  const notWorkingCount = notWorkingIds.size

  return (
    <div className="daily-summary p-2 mt-auto text-center text-sm bg-slate-200 rounded-b-lg grid grid-cols-2 gap-y-1 gap-x-2 font-semibold text-slate-700">
      <span title="בוקר">א׳: <b className="font-bold text-slate-800">{morningCount}</b></span>
      <span title="צהריים">ב׳: <b className="font-bold text-slate-800">{afternoonCount}</b></span>
      <span title="ערב">ג׳: <b className="font-bold text-slate-800">{eveningCount}</b></span>
      <span title="נעדר">ח׳: <b className="font-bold text-slate-800">{notWorkingCount}</b></span>
    </div>
  )
}
