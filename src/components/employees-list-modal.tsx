'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useModalStore } from '@/store/modal-store'
import { useEmployeesStore } from '@/store/employees-store'
import { useLoadingStore } from '@/store/loading-store'

export function EmployeesListModal() {
  const { activeModal, closeModal } = useModalStore()
  const { employees, addEmployee, updateEmployee, deleteEmployee } = useEmployeesStore()
  const { setLoading } = useLoadingStore()
  
  const [isAdding, setIsAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState({ name: '', role: '' })

  if (activeModal !== 'employees-list') return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name || !formData.role) return

    setLoading(true)
    try {
      if (editingId) {
        await updateEmployee(editingId, formData)
        setEditingId(null)
      } else {
        await addEmployee(formData)
      }
      setFormData({ name: '', role: '' })
      setIsAdding(false)
    } catch (error) {
      console.error('Error saving employee:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (employee: any) => {
    setEditingId(employee.id)
    setFormData({ name: employee.name, role: employee.role })
    setIsAdding(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('האם אתה בטוח שברצונך למחוק עובד זה?')) return
    
    setLoading(true)
    try {
      await deleteEmployee(id)
    } catch (error) {
      console.error('Error deleting employee:', error)
    } finally {
      setLoading(false)
    }
  }

  const getRoleIcon = (role: string) => {
    if (['קמ"ן', 'קמ"ן א', 'קמ"ן ב', 'קמב"ל', 'קמב"צ'].includes(role)) return '⭐️'
    if (role === 'ראש צוות') return '⭐'
    return ''
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[10001] p-2 sm:p-4 animate-in fade-in-0 duration-300">
      <div className="modal-content bg-white rounded-2xl shadow-2xl p-4 sm:p-6 w-full max-w-4xl max-h-[95vh] sm:max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-300">
        <div className="flex justify-between items-center mb-4 sm:mb-6 border-b border-slate-200 pb-3 sm:pb-4">
          <div className="flex items-center gap-2 sm:gap-3">
            <div 
              onClick={closeModal}
              className="modal-icon-close w-8 h-8 sm:w-10 sm:h-10 bg-blue-100 rounded-full flex items-center justify-center"
            >
              <i className="fas fa-users text-blue-600 text-base sm:text-lg"></i>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-700">ניהול רשימת עובדים</h2>
          </div>
          <button
            onClick={closeModal}
            className="w-8 h-8 sm:w-10 sm:h-10 bg-slate-100 hover:bg-slate-200 rounded-full flex items-center justify-center text-slate-600 hover:text-slate-800 transition-all duration-200 text-sm sm:text-lg"
            title="סגור"
          >
            <i className="fas fa-times"></i>
          </button>
        </div>

        {/* Add/Edit Form */}
        {isAdding && (
          <div className="mb-6 p-4 bg-slate-50 rounded-lg">
            <h3 className="text-lg font-semibold mb-4">
              {editingId ? 'ערוך עובד' : 'הוסף עובד חדש'}
            </h3>
            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="employee-name">שם מלא</Label>
                <Input
                  id="employee-name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="שם העובד"
                  required
                />
              </div>
              <div>
                <Label htmlFor="employee-role">תפקיד</Label>
                <Input
                  id="employee-role"
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                  placeholder="תפקיד העובד"
                  required
                />
              </div>
              <div className="md:col-span-2 flex gap-2">
                <Button type="submit" className="bg-blue-600 hover:bg-blue-700">
                  {editingId ? 'עדכן' : 'הוסף'}
                </Button>
                <Button 
                  type="button" 
                  variant="outline"
                  onClick={() => {
                    setIsAdding(false)
                    setEditingId(null)
                    setFormData({ name: '', role: '' })
                  }}
                >
                  ביטול
                </Button>
              </div>
            </form>
          </div>
        )}

        {/* Add Button */}
        {!isAdding && (
          <div className="mb-6">
            <Button 
              onClick={() => setIsAdding(true)}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <i className="fas fa-plus ml-2"></i>הוסף עובד חדש
            </Button>
          </div>
        )}

        {/* Employees List */}
        <div className="space-y-2">
          {employees.map((employee) => (
            <div 
              key={employee.id} 
              className="flex items-center justify-between p-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <div className="flex items-center">
                <span className="mr-3 text-lg">{getRoleIcon(employee.role)}</span>
                <div>
                  <p className="font-semibold">{employee.name}</p>
                  <p className="text-sm text-slate-600">{employee.role}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() => handleEdit(employee)}
                  variant="outline"
                  size="sm"
                  className="text-blue-600 hover:text-blue-700"
                >
                  <i className="fas fa-edit"></i>
                </Button>
                <Button
                  onClick={() => handleDelete(employee.id)}
                  variant="outline"
                  size="sm"
                  className="text-red-600 hover:text-red-700"
                >
                  <i className="fas fa-trash"></i>
                </Button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 flex justify-end">
          <Button onClick={closeModal} variant="outline">
            סגור
          </Button>
        </div>
      </div>
    </div>
  )
}
