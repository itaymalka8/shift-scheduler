import { create } from 'zustand'

interface Vehicle {
  id: string
  number: string
  km: number
  status: 'תקין' | 'דורש טיפול' | 'במוסך'
  notes?: string
  lastUpdated: Date
}

interface VehiclesState {
  vehicles: Vehicle[]
  initializeVehicles: () => Promise<void>
  addVehicle: (vehicle: Omit<Vehicle, 'id' | 'lastUpdated'>) => Promise<void>
  updateVehicle: (id: string, vehicle: Partial<Vehicle>) => Promise<void>
  deleteVehicle: (id: string) => Promise<void>
}

export const useVehiclesStore = create<VehiclesState>((set, get) => ({
  vehicles: [],
  
  initializeVehicles: async () => {
    // Initialize with empty array - no default vehicles
    set({ vehicles: [] })
  },
  
  addVehicle: async (vehicle) => {
    const newVehicle = { 
      ...vehicle, 
      id: Date.now().toString(),
      lastUpdated: new Date()
    }
    set((state) => ({ vehicles: [...state.vehicles, newVehicle] }))
  },
  
  updateVehicle: async (id, vehicle) => {
    set((state) => ({
      vehicles: state.vehicles.map(v => 
        v.id === id ? { ...v, ...vehicle, lastUpdated: new Date() } : v
      )
    }))
  },
  
  deleteVehicle: async (id) => {
    set((state) => ({
      vehicles: state.vehicles.filter(v => v.id !== id)
    }))
  }
}))
