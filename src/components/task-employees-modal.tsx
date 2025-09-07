'use client'

import { useModalStore } from '@/store/modal-store'
import { Button } from '@/components/ui/button'

interface Employee {
  id: string
  name: string
  role: string
}

interface TaskEmployeesModalProps {
  task: string
  date: string
  employees: Employee[]
}

export function TaskEmployeesModal() {
  const { activeModal, modalData, closeModal } = useModalStore()

  if (activeModal !== 'task-employees') return null

  const { task, date, employees } = modalData || {}

  const getTaskIcon = (taskName: string) => {
    const iconMap: { [key: string]: string } = {
      'אמל"ח': 'fas fa-shield-alt',
      'סמים': 'fas fa-pills',
      'כלכלי': 'fas fa-chart-line',
      'תגבור': 'fas fa-users',
      'פע"ר': 'fas fa-running',
      'צו חיפוש': 'fas fa-search',
      'חקירות': 'fas fa-search-plus',
      'מסע ציד': 'fas fa-crosshairs',
      'סיורים': 'fas fa-walking',
      'מעקבים': 'fas fa-eye',
      'אחר': 'fas fa-ellipsis-h'
    }
    return iconMap[taskName] || 'fas fa-tasks'
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
        <div className="bg-gradient-to-r from-teal-500 to-blue-600 text-white p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
                <i className={`${getTaskIcon(task)} text-xl`}></i>
              </div>
              <div>
                <h2 className="text-xl font-bold">עובדים במשימה</h2>
                <p className="text-teal-100 text-sm">{task}</p>
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

        {/* Content */}
        <div className="p-6">
          <div className="mb-4">
            <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
              <i className="fas fa-calendar"></i>
              <span>{date}</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <i className="fas fa-users"></i>
              <span>{employees.length} עובדים משובצים</span>
            </div>
          </div>

          {employees.length > 0 ? (
            <div className="space-y-3">
              {employees.map((employee: Employee) => (
                <div 
                  key={employee.id}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                      <i className="fas fa-user text-blue-600"></i>
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900">{employee.name}</div>
                      <div className="text-sm text-gray-600 flex items-center gap-1">
                        {getRoleIcon(employee.role)}
                        {employee.role}
                      </div>
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 bg-white px-2 py-1 rounded-full">
                    פעיל
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <i className="fas fa-user-slash text-gray-400 text-xl"></i>
              </div>
              <p className="text-gray-500">אין עובדים משובצים למשימה זו</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-gray-50 px-6 py-4 flex justify-end">
          <Button onClick={closeModal} className="bg-teal-600 hover:bg-teal-700">
            סגור
          </Button>
        </div>
      </div>
    </div>
  )
}
