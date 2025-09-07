import { create } from 'zustand'

interface Request {
  id: string
  employeeId: string
  requestType: string
  startDate: string
  endDate: string
  reason?: string
  status: 'ממתין לאישור' | 'אושר' | 'נדחה'
  createdAt: Date
}

interface RequestsState {
  requests: Request[]
  initializeRequests: () => Promise<void>
  addRequest: (request: Omit<Request, 'id' | 'createdAt'>) => Promise<void>
  approveRequest: (requestId: string) => Promise<void>
  denyRequest: (requestId: string) => Promise<void>
  deleteRequest: (requestId: string) => Promise<void>
}

export const useRequestsStore = create<RequestsState>((set, get) => ({
  requests: [],
  
  initializeRequests: async () => {
    // Initialize with empty array - no default requests
    set({ requests: [] })
  },
  
  addRequest: async (request) => {
    const newRequest = { 
      ...request, 
      id: Date.now().toString(),
      createdAt: new Date()
    }
    set((state) => ({ requests: [...state.requests, newRequest] }))
  },
  
  approveRequest: async (requestId) => {
    set((state) => ({
      requests: state.requests.map(req => 
        req.id === requestId ? { ...req, status: 'אושר' } : req
      )
    }))
  },
  
  denyRequest: async (requestId) => {
    set((state) => ({
      requests: state.requests.map(req => 
        req.id === requestId ? { ...req, status: 'נדחה' } : req
      )
    }))
  },
  
  deleteRequest: async (requestId) => {
    set((state) => ({
      requests: state.requests.filter(req => req.id !== requestId)
    }))
  }
}))
