import { create } from 'zustand'

interface Shift {
  id: string
  assignments: Assignment[]
}

interface Assignment {
  employeeId: string
  status?: string
  note?: string
  tasks?: string[] // רשימת משימות שהעובד משויך אליהן
}

interface ScheduleState {
  currentWeekOffset: number
  shifts: Record<string, Shift>
  changeWeek: (direction: number) => void
  goToCurrentWeek: () => void
  getCurrentWeekOffset: () => number
  getCurrentDate: () => Date
  initializeSchedule: () => Promise<void>
  assignShift: (shiftKey: string, employeeId: string, status?: string, note?: string) => Promise<void>
  assignEmployeeToTasks: (shiftKey: string, employeeId: string, tasks: string[]) => Promise<void>
  unassignShift: (shiftKey: string, employeeId: string) => Promise<void>
  clearShift: (shiftKey: string) => Promise<void>
  removeEmployeeFromShift: (shiftKey: string, employeeId: string) => Promise<void>
  getEmployeesByTask: (date: string, task: string) => string[]
  getEmployeeShifts: (employeeId: string) => Array<{shiftKey: string, shiftType: string, date: string, tasks?: string[]}>
}

export const useScheduleStore = create<ScheduleState>((set, get) => ({
  currentWeekOffset: 0,
  shifts: {},
  
  changeWeek: (direction) => {
    set((state) => ({ currentWeekOffset: state.currentWeekOffset + direction }))
  },
  
  goToCurrentWeek: () => {
    set({ currentWeekOffset: 0 })
  },
  
  // פונקציה לחישוב השבוע הנוכחי
  getCurrentWeekOffset: () => {
    // התאריך הנוכחי: 5.9.2025, 15:41
    const currentDate = new Date(2025, 8, 5, 15, 41) // חודש 8 = ספטמבר (0-indexed)
    const today = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate())
    
    // מצא את יום ראשון של השבוע הנוכחי
    const dayOfWeek = today.getDay()
    const sunday = new Date(today)
    sunday.setDate(today.getDate() - dayOfWeek)
    
    // חשב את ההפרש בשבועות מהשבוע הנוכחי
    const weekStart = new Date(2024, 0, 7) // שבוע התחלה (7 בינואר 2024)
    const diffTime = sunday.getTime() - weekStart.getTime()
    const diffWeeks = Math.floor(diffTime / (7 * 24 * 60 * 60 * 1000))
    
    return diffWeeks
  },
  
  // פונקציה לקבלת התאריך הנוכחי
  getCurrentDate: () => {
    return new Date(2025, 8, 5, 15, 41) // 5.9.2025, 15:41
  },
  
  initializeSchedule: async () => {
    // התחל מהשבוע הנוכחי
    const currentWeekOffset = get().getCurrentWeekOffset()
    set({ currentWeekOffset, shifts: {} })
  },
  
  assignShift: async (shiftKey, employeeId, status, note) => {
    const { shifts } = get()
    const existingShift = shifts[shiftKey]
    
    const newAssignment = { employeeId, status: status || undefined, note: note || undefined }
    const updatedAssignments = existingShift 
      ? [...existingShift.assignments.filter(a => a.employeeId !== employeeId), newAssignment]
      : [newAssignment]
    
    set((state) => ({
      shifts: {
        ...state.shifts,
        [shiftKey]: { id: shiftKey, assignments: updatedAssignments }
      }
    }))
  },
  
  unassignShift: async (shiftKey, employeeId) => {
    const { shifts } = get()
    const existingShift = shifts[shiftKey]
    
    if (existingShift) {
      const updatedAssignments = existingShift.assignments.filter(a => a.employeeId !== employeeId)
      
      set((state) => ({
        shifts: {
          ...state.shifts,
          [shiftKey]: { id: shiftKey, assignments: updatedAssignments }
        }
      }))
    }
  },
  
  clearShift: async (shiftKey) => {
    set((state) => {
      const newShifts = { ...state.shifts }
      delete newShifts[shiftKey]
      return { shifts: newShifts }
    })
  },
  
  removeEmployeeFromShift: async (shiftKey, employeeId) => {
    const { shifts } = get()
    const existingShift = shifts[shiftKey]
    
    if (existingShift) {
      const updatedAssignments = existingShift.assignments.filter(a => a.employeeId !== employeeId)
      
      set((state) => ({
        shifts: {
          ...state.shifts,
          [shiftKey]: { id: shiftKey, assignments: updatedAssignments }
        }
      }))
    }
  },

  assignEmployeeToTasks: async (shiftKey, employeeId, tasks) => {
    const { shifts } = get()
    const existingShift = shifts[shiftKey]
    
    if (existingShift) {
      const updatedAssignments = existingShift.assignments.map(assignment => 
        assignment.employeeId === employeeId 
          ? { ...assignment, tasks }
          : assignment
      )
      
      set((state) => ({
        shifts: {
          ...state.shifts,
          [shiftKey]: { id: shiftKey, assignments: updatedAssignments }
        }
      }))
    }
  },

  getEmployeesByTask: (date, task) => {
    const { shifts } = get()
    const employeeIds: string[] = []
    
    // חיפוש בכל המשמרות של היום
    Object.keys(shifts).forEach(shiftKey => {
      if (shiftKey.startsWith(date)) {
        const shift = shifts[shiftKey]
        shift.assignments.forEach(assignment => {
          if (assignment.tasks && assignment.tasks.includes(task)) {
            employeeIds.push(assignment.employeeId)
          }
        })
      }
    })
    
    return employeeIds
  },

  getEmployeeShifts: (employeeId) => {
    const { shifts, currentWeekOffset } = get()
    const employeeShifts: Array<{shiftKey: string, shiftType: string, date: string, tasks?: string[]}> = []
    
    // חישוב תאריכי השבוע הנוכחי
    const today = new Date()
    const startOfWeek = new Date(today)
    startOfWeek.setDate(today.getDate() - today.getDay() + 1 + (currentWeekOffset * 7))
    
    // חיפוש בכל המשמרות של השבוע
    Object.keys(shifts).forEach(shiftKey => {
      const shift = shifts[shiftKey]
      const assignment = shift.assignments.find(a => a.employeeId === employeeId)
      
      if (assignment) {
        // חילוץ תאריך וסוג משמרת מהמפתח
        const parts = shiftKey.split('-')
        const date = parts[0]
        const shiftType = parts[1]
        
        // המרת סוג משמרת לעברית
        const shiftTypeMap: { [key: string]: string } = {
          'morning': 'בוקר',
          'afternoon': 'צהריים', 
          'evening': 'ערב'
        }
        
        employeeShifts.push({
          shiftKey,
          shiftType: shiftTypeMap[shiftType] || shiftType,
          date,
          tasks: assignment.tasks
        })
      }
    })
    
    return employeeShifts.sort((a, b) => a.date.localeCompare(b.date))
  }
}))
