'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useModalStore } from '@/store/modal-store'
import { useScheduleStore } from '@/store/schedule-store'
import { useEmployeesStore } from '@/store/employees-store'
import { useWorkPlanStore } from '@/store/work-plan-store'
import { useLoadingStore } from '@/store/loading-store'
import { GanttChart } from '@/components/gantt-chart'

export function SummaryModal() {
  const { activeModal, closeModal } = useModalStore()
  const { currentWeekOffset, shifts } = useScheduleStore()
  const { employees } = useEmployeesStore()
  const { workPlans } = useWorkPlanStore()
  const { setLoading } = useLoadingStore()
  
  const [summaryText, setSummaryText] = useState('')
  const [showGanttView, setShowGanttView] = useState(false)

  if (activeModal !== 'summary') return null

  const generateSummary = () => {
    setLoading(true)
    
    // Calculate week dates
    const getSunday = (d: Date) => {
      d = new Date(d)
      const day = d.getDay()
      const diff = d.getDate() - day
      return new Date(d.setDate(diff))
    }
    
    const sunday = getSunday(new Date(new Date().setDate(new Date().getDate() + currentWeekOffset * 7)))
    const weekStart = new Date(sunday)
    const weekEnd = new Date(sunday)
    weekEnd.setDate(sunday.getDate() + 6)
    
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
    const shiftTypes = ['משמרת בוקר', 'משמרת צהריים', 'משמרת ערב']
    
    let summary = `סיכום שבועי: ${formatDate(weekStart)} - ${formatDate(weekEnd)}\n\n`
    
    // Employee assignments summary
    summary += '📋 שיבוץ עובדים:\n'
    summary += '================\n'
    
    const employeeStats: Record<string, { name: string, role: string, shifts: number, statuses: Record<string, number> }> = {}
    
    // Initialize employee stats
    employees.forEach(emp => {
      employeeStats[emp.id] = {
        name: emp.name,
        role: emp.role,
        shifts: 0,
        statuses: {}
      }
    })
    
    // Count assignments for each employee
    Object.values(shifts).forEach(shift => {
      shift.assignments.forEach(assignment => {
        const emp = employeeStats[assignment.employeeId]
        if (emp) {
          emp.shifts++
          if (assignment.status) {
            emp.statuses[assignment.status] = (emp.statuses[assignment.status] || 0) + 1
          }
        }
      })
    })
    
    // Add employee summary to text
    Object.values(employeeStats)
      .filter(emp => emp.shifts > 0)
      .sort((a, b) => b.shifts - a.shifts)
      .forEach(emp => {
        summary += `• ${emp.name} (${emp.role}): ${emp.shifts} משמרות`
        const statusList = Object.entries(emp.statuses)
          .map(([status, count]) => `${count}x ${status}`)
          .join(', ')
        if (statusList) {
          summary += ` (${statusList})`
        }
        summary += '\n'
      })
    
    summary += '\n📅 תכנון פעילות:\n'
    summary += '================\n'
    
    // Work plans summary
    const weekWorkPlans = Object.values(workPlans).filter(plan => {
      const planDate = new Date(plan.date + 'T00:00:00')
      return planDate >= weekStart && planDate <= weekEnd
    })
    
    if (weekWorkPlans.length > 0) {
      weekWorkPlans.forEach(plan => {
        const planDate = new Date(plan.date + 'T00:00:00')
        const dayName = daysOfWeek[planDate.getDay()]
        summary += `• ${dayName} ${formatDate(planDate)} (${plan.startTime || '08:00'}-${plan.endTime || '16:00'}):\n`
        const allTasks = [...plan.generalTasks, ...plan.shiftTasks.morning, ...plan.shiftTasks.afternoon, ...plan.shiftTasks.evening]
        summary += `  ${allTasks.join(', ')}\n`
        if (plan.notes) {
          summary += `  הערה: ${plan.notes}\n`
        }
        summary += '\n'
      })
    } else {
      summary += 'אין תכנון פעילות לשבוע זה\n\n'
    }
    
    // Daily breakdown
    summary += '📊 פירוט יומי:\n'
    summary += '==============\n'
    
    for (let i = 0; i < 7; i++) {
      const currentDate = new Date(weekStart)
      currentDate.setDate(weekStart.getDate() + i)
      const dateStr = getDateString(currentDate)
      const dayName = daysOfWeek[currentDate.getDay()]
      
      summary += `${dayName} ${formatDate(currentDate)}:\n`
      
      let dayHasAssignments = false
      shiftTypes.forEach(shiftType => {
        const shiftKey = `${dateStr}-${shiftType}`
        const shiftData = shifts[shiftKey]
        
        if (shiftData && shiftData.assignments.length > 0) {
          dayHasAssignments = true
          summary += `  ${shiftType}:\n`
          
          const groupedByCategory: Record<string, any[]> = {}
          shiftData.assignments.forEach(assignment => {
            const employee = employees.find(e => e.id === assignment.employeeId)
            if (employee) {
              const category = getCategoryByRole(employee.role)
              if (!groupedByCategory[category]) {
                groupedByCategory[category] = []
              }
              groupedByCategory[category].push({ employee, assignment })
            }
          })
          
          Object.entries(groupedByCategory).forEach(([category, assignments]) => {
            summary += `    ${category}: `
            const employeeList = assignments.map(({ employee, assignment }) => {
              let text = employee.name
              if (assignment.status) {
                text += ` (${assignment.status})`
              }
              return text
            }).join(', ')
            summary += employeeList + '\n'
          })
        }
      })
      
      if (!dayHasAssignments) {
        summary += '  אין שיבוצים\n'
      }
      summary += '\n'
    }
    
    setSummaryText(summary)
    setLoading(false)
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
  
  const copyToClipboard = () => {
    navigator.clipboard.writeText(summaryText)
    alert('הסיכום הועתק ללוח!')
  }
  
  const downloadAsText = () => {
    const blob = new Blob([summaryText], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `סיכום_שבועי_${new Date().toISOString().split('T')[0]}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[10001] p-2 sm:p-4 animate-in fade-in-0 duration-300">
      <div className="bg-white rounded-2xl shadow-2xl p-4 sm:p-6 w-full max-w-6xl max-h-[95vh] sm:max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-300">
        <div className="flex justify-between items-center mb-4 sm:mb-6 border-b border-slate-200 pb-3 sm:pb-4">
          <div className="flex items-center gap-2 sm:gap-3">
            <div 
              onClick={closeModal}
              className="modal-icon-close w-8 h-8 sm:w-10 sm:h-10 bg-teal-100 rounded-full flex items-center justify-center"
            >
              <i className="fas fa-chart-bar text-teal-600 text-base sm:text-lg"></i>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-700">צור הודעת סיכום</h2>
          </div>
          <button
            onClick={closeModal}
            className="w-8 h-8 sm:w-10 sm:h-10 bg-slate-100 hover:bg-slate-200 rounded-full flex items-center justify-center text-slate-600 hover:text-slate-800 transition-all duration-200 text-sm sm:text-lg"
          >
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="mb-6">
          <div className="flex gap-2 flex-wrap">
            <Button 
              onClick={generateSummary}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              <i className="fas fa-magic ml-2"></i>צור סיכום שבועי
            </Button>
            {typeof window !== 'undefined' && (
              <Button 
                onClick={() => setShowGanttView(!showGanttView)}
                className="bg-purple-600 hover:bg-purple-700 text-white"
              >
                <i className="fas fa-chart-gantt ml-2"></i>
                {showGanttView ? 'הסתר גאנט' : 'תצוגת גאנט'}
              </Button>
            )}
          </div>
        </div>

        {summaryText && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <Button 
                onClick={copyToClipboard}
                variant="outline"
                className="bg-green-50 hover:bg-green-100"
              >
                <i className="fas fa-copy ml-2"></i>העתק ללוח
              </Button>
              <Button 
                onClick={downloadAsText}
                variant="outline"
                className="bg-blue-50 hover:bg-blue-100"
              >
                <i className="fas fa-download ml-2"></i>הורד כקובץ
              </Button>
            </div>
            
            <div className="bg-slate-50 rounded-lg p-4">
              <h3 className="font-semibold mb-2">סיכום שבועי:</h3>
              <pre className="whitespace-pre-wrap text-sm font-mono text-slate-700 leading-relaxed">
                {summaryText}
              </pre>
            </div>
          </div>
        )}

        {showGanttView && (
          <div className="mb-6">
            <h3 className="text-lg font-semibold mb-4">תצוגת גאנט שבועית</h3>
            <div className="bg-slate-50 rounded-lg p-4 overflow-x-auto">
              <GanttChart />
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <Button onClick={closeModal} variant="outline">
            סגור
          </Button>
        </div>
      </div>
    </div>
  )
}
