import { create } from 'zustand'

interface Permission {
  id: string
  name: string
  description: string
  category: 'schedule' | 'employees' | 'vehicles' | 'requests' | 'workplan' | 'users' | 'system'
}

interface User {
  id: string
  username: string
  password: string
  email: string
  role: 'admin' | 'manager' | 'user'
  name: string
  permissions: string[] // Array of permission IDs
  isActive: boolean
  createdAt: Date
  lastLogin?: Date
}

interface AuthState {
  currentUser: User | null
  isAuthenticated: boolean
  users: User[]
  permissions: Permission[]
  login: (username: string, password: string) => Promise<boolean>
  register: (userData: Omit<User, 'id' | 'createdAt' | 'lastLogin'>) => Promise<boolean>
  logout: () => void
  initializeUsers: () => Promise<void>
  addUser: (user: Omit<User, 'id' | 'createdAt'>) => Promise<void>
  updateUser: (id: string, user: Partial<User>) => Promise<void>
  deleteUser: (id: string) => Promise<void>
  hasPermission: (permissionId: string) => boolean
  canManageUsers: () => boolean
}

export const useAuthStore = create<AuthState>((set, get) => ({
  currentUser: null,
  isAuthenticated: false,
  users: [],
  permissions: [],
  
  login: async (username: string, password: string) => {
    const { users } = get()
    const user = users.find(u => u.username === username && u.password === password && u.isActive)
    
    if (user) {
      // עדכון זמן התחברות אחרונה
      const updatedUser = { ...user, lastLogin: new Date() }
      set((state) => ({
        currentUser: updatedUser,
        isAuthenticated: true,
        users: state.users.map(u => u.id === user.id ? updatedUser : u)
      }))
      return true
    }
    return false
  },
  
  register: async (userData) => {
    const { users } = get()
    
    // בדיקה אם שם המשתמש או המייל כבר קיימים
    const existingUser = users.find(u => 
      u.username === userData.username || u.email === userData.email
    )
    
    if (existingUser) {
      return false // שם משתמש או מייל כבר קיימים
    }
    
    const newUser: User = {
      ...userData,
      id: Date.now().toString(),
      createdAt: new Date()
    }
    
    set((state) => ({
      users: [...state.users, newUser]
    }))
    
    return true
  },
  
  logout: () => {
    set({ currentUser: null, isAuthenticated: false })
  },
  
  initializeUsers: async () => {
    // הרשאות ברירת מחדל
    const defaultPermissions: Permission[] = [
      // סידור עבודה
      { id: 'schedule_view', name: 'צפייה בסידור עבודה', description: 'צפייה בלוח המשמרות השבועי', category: 'schedule' },
      { id: 'schedule_edit', name: 'עריכת סידור עבודה', description: 'שיבוץ עובדים למשמרות', category: 'schedule' },
      { id: 'schedule_manage', name: 'ניהול סידור עבודה', description: 'ניהול מלא של הסידור', category: 'schedule' },
      
      // עובדים
      { id: 'employees_view', name: 'צפייה ברשימת עובדים', description: 'צפייה ברשימת העובדים', category: 'employees' },
      { id: 'employees_edit', name: 'עריכת עובדים', description: 'הוספה ועריכה של עובדים', category: 'employees' },
      { id: 'employees_manage', name: 'ניהול עובדים', description: 'ניהול מלא של העובדים', category: 'employees' },
      
      // רכבים
      { id: 'vehicles_view', name: 'צפייה ברשימת רכבים', description: 'צפייה ברשימת הרכבים', category: 'vehicles' },
      { id: 'vehicles_edit', name: 'עריכת רכבים', description: 'הוספה ועריכה של רכבים', category: 'vehicles' },
      { id: 'vehicles_manage', name: 'ניהול רכבים', description: 'ניהול מלא של הרכבים', category: 'vehicles' },
      
      // בקשות
      { id: 'requests_view', name: 'צפייה בבקשות', description: 'צפייה בבקשות עובדים', category: 'requests' },
      { id: 'requests_approve', name: 'אישור בקשות', description: 'אישור ודחיית בקשות', category: 'requests' },
      { id: 'requests_manage', name: 'ניהול בקשות', description: 'ניהול מלא של הבקשות', category: 'requests' },
      
      // תכנון עבודה
      { id: 'workplan_view', name: 'צפייה בתכנון עבודה', description: 'צפייה בתכנון העבודה היומי', category: 'workplan' },
      { id: 'workplan_edit', name: 'עריכת תכנון עבודה', description: 'הוספה ועריכה של תכנון עבודה', category: 'workplan' },
      { id: 'workplan_manage', name: 'ניהול תכנון עבודה', description: 'ניהול מלא של התכנון', category: 'workplan' },
      
      // משתמשים
      { id: 'users_view', name: 'צפייה במשתמשים', description: 'צפייה ברשימת המשתמשים', category: 'users' },
      { id: 'users_edit', name: 'עריכת משתמשים', description: 'הוספה ועריכה של משתמשים', category: 'users' },
      { id: 'users_manage', name: 'ניהול משתמשים', description: 'ניהול מלא של המשתמשים', category: 'users' },
      
      // מערכת
      { id: 'system_settings', name: 'הגדרות מערכת', description: 'גישה להגדרות המערכת', category: 'system' },
      { id: 'system_reports', name: 'דוחות מערכת', description: 'גישה לדוחות המערכת', category: 'system' }
    ]
    
    // משתמשים ברירת מחדל
    const defaultUsers: User[] = [
      {
        id: '1',
        username: 'itaymalka8',
        password: '1990',
        email: 'itaymalka8@gmail.com',
        role: 'admin',
        name: 'איתי מלכא',
        permissions: defaultPermissions.map(p => p.id), // כל ההרשאות
        isActive: true,
        createdAt: new Date()
      },
      {
        id: '2',
        username: 'admin',
        password: 'admin123',
        email: 'admin@example.com',
        role: 'admin',
        name: 'מנהל מערכת',
        permissions: defaultPermissions.map(p => p.id), // כל ההרשאות
        isActive: true,
        createdAt: new Date()
      },
      {
        id: '3',
        username: 'manager1',
        password: 'manager123',
        email: 'manager@example.com',
        role: 'manager',
        name: 'מנהל משמרות',
        permissions: [
          'schedule_view', 'schedule_edit', 'schedule_manage',
          'employees_view', 'employees_edit',
          'vehicles_view', 'vehicles_edit',
          'requests_view', 'requests_approve',
          'workplan_view', 'workplan_edit', 'workplan_manage'
        ],
        isActive: true,
        createdAt: new Date()
      },
      {
        id: '4',
        username: 'user1',
        password: 'user123',
        email: 'user1@example.com',
        role: 'user',
        name: 'משתמש רגיל',
        permissions: [
          'schedule_view',
          'employees_view',
          'vehicles_view',
          'requests_view',
          'workplan_view'
        ],
        isActive: true,
        createdAt: new Date()
      }
    ]
    
    set({ users: defaultUsers, permissions: defaultPermissions })
  },
  
  addUser: async (userData) => {
    const newUser: User = {
      ...userData,
      id: Date.now().toString(),
      createdAt: new Date()
    }
    
    set((state) => ({
      users: [...state.users, newUser]
    }))
  },
  
  updateUser: async (id, userData) => {
    set((state) => ({
      users: state.users.map(user => 
        user.id === id ? { ...user, ...userData } : user
      )
    }))
  },
  
  deleteUser: async (id) => {
    set((state) => ({
      users: state.users.filter(user => user.id !== id)
    }))
  },
  
  hasPermission: (permissionId: string) => {
    const { currentUser } = get()
    if (!currentUser) return false
    
    // מנהל יש לו כל ההרשאות
    if (currentUser.role === 'admin') return true
    
    // בדיקה אם למשתמש יש את ההרשאה הספציפית
    return currentUser.permissions.includes(permissionId)
  },
  
  canManageUsers: () => {
    const { currentUser } = get()
    if (!currentUser) return false
    
    // רק מנהלים יכולים לנהל משתמשים
    return currentUser.role === 'admin' && currentUser.permissions.includes('users_manage')
  }
}))
