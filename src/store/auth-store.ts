import { create } from 'zustand'

interface User {
  id: string
  username: string
  password: string
  role: 'admin' | 'manager' | 'user'
  permissions: string[]
}

interface AuthState {
  isAuthenticated: boolean
  currentUser: User | null
  users: User[]
  login: (username: string, password: string) => boolean
  logout: () => void
  initializeUsers: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  currentUser: null,
  users: [],
  
  login: (username: string, password: string) => {
    const user = useAuthStore.getState().users.find(
      u => u.username === username && u.password === password
    )
    
    if (user) {
      set({ isAuthenticated: true, currentUser: user })
      return true
    }
    return false
  },
  
  logout: () => {
    set({ isAuthenticated: false, currentUser: null })
  },
  
  initializeUsers: () => {
    const defaultUsers: User[] = [
      {
        id: '1',
        username: 'itaymalka8',
        password: '1990',
        role: 'admin',
        permissions: ['all']
      },
      {
        id: '2',
        username: 'admin',
        password: 'admin123',
        role: 'admin',
        permissions: ['all']
      }
    ]
    
    set({ users: defaultUsers })
  }
}))
