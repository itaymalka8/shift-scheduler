import { create } from 'zustand'

interface WorkPlan {
  id: string
  date: string
  generalTasks: string[] // משימות כלליות ללא שיוך
  shiftTasks: {
    morning: string[]
    afternoon: string[]
    evening: string[]
  }
  notes?: string
  startTime?: string
  endTime?: string
  createdAt: Date
}

interface WorkPlanState {
  workPlans: { [key: string]: WorkPlan }
  initializeWorkPlans: () => Promise<void>
  addWorkPlan: (workPlan: Omit<WorkPlan, 'id' | 'createdAt'>) => Promise<void>
  updateWorkPlan: (id: string, workPlan: Partial<WorkPlan>) => Promise<void>
  deleteWorkPlan: (id: string) => Promise<void>
  getWorkPlanByDate: (date: string) => WorkPlan | undefined
}

export const useWorkPlanStore = create<WorkPlanState>((set, get) => ({
  workPlans: {},
  
  initializeWorkPlans: async () => {
    // Initialize with empty object - no default work plans
    set({ workPlans: {} })
  },
  
  addWorkPlan: async (workPlan) => {
    const newWorkPlan = { 
      ...workPlan, 
      id: Date.now().toString(),
      createdAt: new Date()
    }
    set((state) => ({ 
      workPlans: { 
        ...state.workPlans, 
        [newWorkPlan.date]: newWorkPlan 
      } 
    }))
  },
  
  updateWorkPlan: async (id, workPlan) => {
    set((state) => {
      const updatedPlans = { ...state.workPlans }
      Object.values(updatedPlans).forEach(wp => {
        if (wp.id === id) {
          Object.assign(wp, workPlan)
        }
      })
      return { workPlans: updatedPlans }
    })
  },
  
  deleteWorkPlan: async (id) => {
    set((state) => {
      const updatedPlans = { ...state.workPlans }
      Object.keys(updatedPlans).forEach(date => {
        if (updatedPlans[date].id === id) {
          delete updatedPlans[date]
        }
      })
      return { workPlans: updatedPlans }
    })
  },
  
  getWorkPlanByDate: (date) => {
    const state = get()
    return state.workPlans[date]
  }
}))