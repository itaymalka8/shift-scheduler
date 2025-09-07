'use client'

import { useState, useEffect } from 'react'
import { useAuthStore } from '@/store/auth-store'

export default function UserManagement() {
  const { users, permissions, addUser, updateUser, deleteUser, canManageUsers, currentUser } = useAuthStore()
  const [isAddingUser, setIsAddingUser] = useState(false)
  const [editingUser, setEditingUser] = useState<string | null>(null)
  const [newUser, setNewUser] = useState({
    username: '',
    password: '',
    email: '',
    name: '',
    role: 'user' as 'admin' | 'manager' | 'user',
    permissions: [] as string[]
  })

  useEffect(() => {
    if (!canManageUsers()) {
      // אם המשתמש לא יכול לנהל משתמשים, הפנה אותו לדף הראשי
      window.location.href = '/schedule'
    }
  }, [canManageUsers])

  if (!canManageUsers()) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center text-white">
          <h1 className="text-2xl font-bold mb-4">אין לך הרשאה לגשת לדף זה</h1>
          <p>רק מנהלים יכולים לנהל משתמשים</p>
        </div>
      </div>
    )
  }

  const handleAddUser = async () => {
    if (newUser.username && newUser.password && newUser.email && newUser.name) {
      await addUser({
        ...newUser,
        isActive: true
      })
      setNewUser({
        username: '',
        password: '',
        email: '',
        name: '',
        role: 'user',
        permissions: []
      })
      setIsAddingUser(false)
    }
  }

  const handleUpdateUser = async (userId: string) => {
    const user = users.find(u => u.id === userId)
    if (user) {
      await updateUser(userId, {
        ...user,
        permissions: newUser.permissions
      })
      setEditingUser(null)
    }
  }

  const handleDeleteUser = async (userId: string) => {
    if (confirm('האם אתה בטוח שברצונך למחוק את המשתמש?')) {
      await deleteUser(userId)
    }
  }

  const togglePermission = (permissionId: string) => {
    setNewUser(prev => ({
      ...prev,
      permissions: prev.permissions.includes(permissionId)
        ? prev.permissions.filter(p => p !== permissionId)
        : [...prev.permissions, permissionId]
    }))
  }

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'admin': return 'bg-red-100 text-red-800'
      case 'manager': return 'bg-blue-100 text-blue-800'
      case 'user': return 'bg-green-100 text-green-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getRoleText = (role: string) => {
    switch (role) {
      case 'admin': return 'מנהל'
      case 'manager': return 'מנהל משמרות'
      case 'user': return 'משתמש'
      default: return role
    }
  }

  const groupedPermissions = permissions.reduce((acc, permission) => {
    if (!acc[permission.category]) {
      acc[permission.category] = []
    }
    acc[permission.category].push(permission)
    return acc
  }, {} as Record<string, typeof permissions>)

  return (
    <div className="min-h-screen bg-slate-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-2xl p-6 mb-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-slate-800 mb-2">
                ניהול משתמשים
              </h1>
              <p className="text-slate-600">
                ניהול הרשאות ומשתמשים במערכת
              </p>
            </div>
            <button
              onClick={() => setIsAddingUser(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg transition-colors flex items-center gap-2"
            >
              <i className="fas fa-user-plus"></i>
              הוסף משתמש
            </button>
          </div>
        </div>

        {/* Users List */}
        <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-100">
                <tr>
                  <th className="px-6 py-4 text-right text-slate-700 font-semibold">שם</th>
                  <th className="px-6 py-4 text-right text-slate-700 font-semibold">שם משתמש</th>
                  <th className="px-6 py-4 text-right text-slate-700 font-semibold">מייל</th>
                  <th className="px-6 py-4 text-right text-slate-700 font-semibold">תפקיד</th>
                  <th className="px-6 py-4 text-right text-slate-700 font-semibold">סטטוס</th>
                  <th className="px-6 py-4 text-right text-slate-700 font-semibold">התחברות אחרונה</th>
                  <th className="px-6 py-4 text-right text-slate-700 font-semibold">פעולות</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-b border-slate-200 hover:bg-slate-50">
                    <td className="px-6 py-4 text-slate-800 font-medium">{user.name}</td>
                    <td className="px-6 py-4 text-slate-600">{user.username}</td>
                    <td className="px-6 py-4 text-slate-600">{user.email}</td>
                    <td className="px-6 py-4">
                      <span className={`px-3 py-1 rounded-full text-sm font-medium ${getRoleColor(user.role)}`}>
                        {getRoleText(user.role)}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                        user.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                      }`}>
                        {user.isActive ? 'פעיל' : 'לא פעיל'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-slate-600 text-sm">
                      {user.lastLogin ? new Date(user.lastLogin).toLocaleString('he-IL') : 'לא התחבר'}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setEditingUser(user.id)
                            setNewUser({
                              username: user.username,
                              password: '',
                              email: user.email,
                              name: user.name,
                              role: user.role,
                              permissions: user.permissions
                            })
                          }}
                          className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded text-sm"
                        >
                          <i className="fas fa-edit"></i>
                        </button>
                        {user.id !== currentUser?.id && (
                          <button
                            onClick={() => handleDeleteUser(user.id)}
                            className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded text-sm"
                          >
                            <i className="fas fa-trash"></i>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Add/Edit User Modal */}
        {(isAddingUser || editingUser) && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-slate-800">
                  {isAddingUser ? 'הוסף משתמש חדש' : 'ערוך משתמש'}
                </h2>
                <button
                  onClick={() => {
                    setIsAddingUser(false)
                    setEditingUser(null)
                    setNewUser({
                      username: '',
                      password: '',
                      email: '',
                      name: '',
                      role: 'user',
                      permissions: []
                    })
                  }}
                  className="text-slate-500 hover:text-slate-700"
                >
                  <i className="fas fa-times text-xl"></i>
                </button>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">שם מלא</label>
                    <input
                      type="text"
                      value={newUser.name}
                      onChange={(e) => setNewUser(prev => ({ ...prev, name: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="הקלד שם מלא"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">שם משתמש</label>
                    <input
                      type="text"
                      value={newUser.username}
                      onChange={(e) => setNewUser(prev => ({ ...prev, username: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="הקלד שם משתמש"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">מייל</label>
                    <input
                      type="email"
                      value={newUser.email}
                      onChange={(e) => setNewUser(prev => ({ ...prev, email: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="הקלד מייל"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">תפקיד</label>
                    <select
                      value={newUser.role}
                      onChange={(e) => setNewUser(prev => ({ ...prev, role: e.target.value as 'admin' | 'manager' | 'user' }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="user">משתמש</option>
                      <option value="manager">מנהל משמרות</option>
                      <option value="admin">מנהל</option>
                    </select>
                  </div>
                </div>

                {isAddingUser && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">סיסמה</label>
                    <input
                      type="password"
                      value={newUser.password}
                      onChange={(e) => setNewUser(prev => ({ ...prev, password: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="הקלד סיסמה"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">הרשאות</label>
                  <div className="space-y-4">
                    {Object.entries(groupedPermissions).map(([category, categoryPermissions]) => (
                      <div key={category}>
                        <h4 className="text-sm font-semibold text-slate-700 mb-2 capitalize">
                          {category === 'schedule' ? 'סידור עבודה' :
                           category === 'employees' ? 'עובדים' :
                           category === 'vehicles' ? 'רכבים' :
                           category === 'requests' ? 'בקשות' :
                           category === 'workplan' ? 'תכנון עבודה' :
                           category === 'users' ? 'משתמשים' :
                           category === 'system' ? 'מערכת' : category}
                        </h4>
                        <div className="grid grid-cols-2 gap-2">
                          {categoryPermissions.map((permission) => (
                            <label key={permission.id} className="flex items-center space-x-2 space-x-reverse">
                              <input
                                type="checkbox"
                                checked={newUser.permissions.includes(permission.id)}
                                onChange={() => togglePermission(permission.id)}
                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                              <span className="text-sm text-slate-700">{permission.name}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-4">
                  <button
                    onClick={() => {
                      setIsAddingUser(false)
                      setEditingUser(null)
                      setNewUser({
                        username: '',
                        password: '',
                        email: '',
                        name: '',
                        role: 'user',
                        permissions: []
                      })
                    }}
                    className="px-4 py-2 text-slate-600 hover:text-slate-800"
                  >
                    ביטול
                  </button>
                  <button
                    onClick={isAddingUser ? handleAddUser : () => handleUpdateUser(editingUser!)}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg"
                  >
                    {isAddingUser ? 'הוסף' : 'עדכן'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

