import { create } from 'zustand'

interface Employee {
  id: string
  name: string
  role: string
}

interface EmployeesState {
  employees: Employee[]
  initializeEmployees: () => Promise<void>
  addEmployee: (employee: Omit<Employee, 'id'>) => Promise<void>
  updateEmployee: (id: string, employee: Partial<Employee>) => Promise<void>
  deleteEmployee: (id: string) => Promise<void>
}

export const useEmployeesStore = create<EmployeesState>((set, get) => ({
  employees: [],
  
  initializeEmployees: async () => {
    // Mock data for now - will be replaced with Firebase
    const mockEmployees: Employee[] = [
      { id: '1', name: 'איתי מלכה', role: 'קמב"ל' },
      { id: '2', name: 'ניסים סויסה', role: 'קמ"ן' },
      { id: '3', name: 'יונתן בדיחי', role: 'קמ"ן פקד' },
      { id: '4', name: 'טל טסטה', role: 'רכז' },
      { id: '5', name: 'דודי קינן', role: 'רכז' },
      { id: '6', name: 'מתי חוגה', role: 'רכז' },
      { id: '7', name: 'גתהון טל', role: 'בלש' },
      { id: '8', name: 'מתן אלקובי', role: 'בלש' },
      { id: '9', name: 'אמג\'ד טריף', role: 'בלש' },
      { id: '10', name: 'אביאל פיקל', role: 'בלש' },
      { id: '11', name: 'אביחי ירובצקי', role: 'בלש' },
      { id: '12', name: 'ענאן ח\'יר אלדין', role: 'בלש' },
      { id: '13', name: 'סולי חגאגרה', role: 'בלש' },
      { id: '14', name: 'אחיה בן-עוקבי', role: 'בלש' },
      { id: '15', name: 'אוריאל כהן', role: 'בלש' },
      { id: '16', name: 'יהודה הכרי', role: 'בלש' },
      { id: '17', name: 'טל ארז', role: 'הערכה' },
      { id: '18', name: 'אנה מור', role: 'הערכה' },
      { id: '19', name: 'ליאל פרץ', role: 'הערכה' }
    ]

    set({ employees: mockEmployees })
  },
  
  addEmployee: async (employee) => {
    const newEmployee = { ...employee, id: Date.now().toString() }
    set((state) => ({ employees: [...state.employees, newEmployee] }))
  },
  
  updateEmployee: async (id, employee) => {
    set((state) => ({
      employees: state.employees.map(emp => 
        emp.id === id ? { ...emp, ...employee } : emp
      )
    }))
  },
  
  deleteEmployee: async (id) => {
    set((state) => ({
      employees: state.employees.filter(emp => emp.id !== id)
    }))
  }
}))
