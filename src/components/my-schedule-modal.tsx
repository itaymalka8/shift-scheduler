'use client'

import { useState } from 'react'
import { useModalStore } from '@/store/modal-store'
import { useEmployeesStore } from '@/store/employees-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function MyScheduleModal() {
  const { activeModal, modalData, closeModal, openModal } = useModalStore()
  const { employees } = useEmployeesStore()
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null)

  if (activeModal !== 'my-schedule') return null

  const filteredEmployees = employees.filter(employee =>
    employee.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    employee.role.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const handleEmployeeSelect = (employeeId: string) => {
    setSelectedEmployee(employeeId)
    openModal('personal-schedule', { employeeId })
  }

  const getRoleIcon = (role: string) => {
    if (['קמ"ן', 'קמ"ן א', 'קמ"ן ב', 'קמב"ל', 'קמב"צ'].includes(role)) return '⭐️'
    if (role === 'ראש צוות') return '⭐'
    return ''
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[10001] p-2 sm:p-4 animate-in fade-in-0 duration-300">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-hidden animate-in slide-in-from-bottom-4 duration-300">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-500 to-pink-600 text-white p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
                <i className="fas fa-user-clock text-xl"></i>
              </div>
              <div>
                <h2 className="text-xl font-bold">המשמרות שלי</h2>
                <p className="text-purple-100 text-sm">בחר את שמך לראות את המשמרות</p>
              </div>
            </div>
            <button
              onClick={closeModal}
              className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center hover:bg-white/30 transition-colors"
            >
              <i className="fas fa-times text-sm"></i>
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="p-6 border-b">
          <div className="relative">
            <i className="fas fa-search absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400"></i>
            <Input
              type="text"
              placeholder="חפש עובד..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pr-10 text-right"
            />
          </div>
        </div>

        {/* Employee List */}
        <div className="p-6 max-h-96 overflow-y-auto">
          {filteredEmployees.length > 0 ? (
            <div className="space-y-3">
              {filteredEmployees.map((employee) => (
                <button
                  key={employee.id}
                  onClick={() => handleEmployeeSelect(employee.id)}
                  className="w-full flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors text-right"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
                      <i className="fas fa-user text-purple-600"></i>
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900">{employee.name}</div>
                      <div className="text-sm text-gray-600 flex items-center gap-1">
                        {getRoleIcon(employee.role)}
                        {employee.role}
                      </div>
                    </div>
                  </div>
                  <i className="fas fa-chevron-left text-gray-400"></i>
                </button>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <i className="fas fa-user-slash text-gray-400 text-xl"></i>
              </div>
              <p className="text-gray-500">לא נמצאו עובדים</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-gray-50 px-6 py-4 flex justify-end">
          <Button onClick={closeModal} className="bg-gray-600 hover:bg-gray-700">
            ביטול
          </Button>
        </div>
      </div>
    </div>
  )
}

