'use client'

import { useModalStore } from '@/store/modal-store'
import { useEmployeesStore } from '@/store/employees-store'
import { useScheduleStore } from '@/store/schedule-store'
import { Button } from '@/components/ui/button'

export function PersonalScheduleModal() {
  const { activeModal, modalData, closeModal } = useModalStore()
  const { employees } = useEmployeesStore()
  const { getEmployeeShifts, currentWeekOffset } = useScheduleStore()

  if (activeModal !== 'personal-schedule') return null

  const employeeId = modalData?.employeeId
  const employee = employees.find(emp => emp.id === employeeId)
  const shifts = getEmployeeShifts(employeeId)

  const getShiftIcon = (shiftType: string) => {
    const iconMap: { [key: string]: string } = {
      'בוקר': 'fas fa-sun',
      'צהריים': 'fas fa-sun',
      'ערב': 'fas fa-moon'
    }
    return iconMap[shiftType] || 'fas fa-clock'
  }

  const getShiftColor = (shiftType: string) => {
    const colorMap: { [key: string]: string } = {
      'בוקר': 'bg-yellow-100 text-yellow-800 border-yellow-200',
      'צהריים': 'bg-orange-100 text-orange-800 border-orange-200',
      'ערב': 'bg-blue-100 text-blue-800 border-blue-200'
    }
    return colorMap[shiftType] || 'bg-gray-100 text-gray-800 border-gray-200'
  }

  const getTaskIcon = (task?: string) => {
    if (!task) return 'fas fa-clock'
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
    return iconMap[task] || 'fas fa-tasks'
  }

  const getTaskColor = (task?: string) => {
    if (!task) return 'bg-gray-100 text-gray-600'
    const colorMap: { [key: string]: string } = {
      'אמל"ח': 'bg-red-100 text-red-800',
      'סמים': 'bg-purple-100 text-purple-800',
      'כלכלי': 'bg-green-100 text-green-800',
      'תגבור': 'bg-blue-100 text-blue-800',
      'פע"ר': 'bg-green-100 text-green-800',
      'צו חיפוש': 'bg-yellow-100 text-yellow-800',
      'חקירות': 'bg-indigo-100 text-indigo-800',
      'מסע ציד': 'bg-orange-100 text-orange-800',
      'סיורים': 'bg-teal-100 text-teal-800',
      'מעקבים': 'bg-pink-100 text-pink-800',
      'אחר': 'bg-gray-100 text-gray-800'
    }
    return colorMap[task] || 'bg-gray-100 text-gray-800'
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString('he-IL', { 
      weekday: 'long', 
      day: 'numeric', 
      month: 'long' 
    })
  }

  const getWeekTitle = () => {
    if (currentWeekOffset === 0) return 'השבוע הנוכחי'
    if (currentWeekOffset > 0) return `שבוע +${currentWeekOffset}`
    return `שבוע ${currentWeekOffset}`
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[10001] p-2 sm:p-4 animate-in fade-in-0 duration-300">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden animate-in slide-in-from-bottom-4 duration-300">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-500 to-pink-600 text-white p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
                <i className="fas fa-user-clock text-xl"></i>
              </div>
              <div>
                <h2 className="text-xl font-bold">המשמרות שלי</h2>
                <p className="text-purple-100 text-sm">{employee?.name} - {getWeekTitle()}</p>
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
        <div className="p-6 max-h-96 overflow-y-auto">
          {shifts.length > 0 ? (
            <div className="space-y-4">
              {shifts.map((shift, index) => (
                <div key={index} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${getShiftColor(shift.shiftType)}`}>
                        <i className={`${getShiftIcon(shift.shiftType)} text-sm`}></i>
                      </div>
                      <div>
                        <div className="font-semibold text-gray-900">{formatDate(shift.date)}</div>
                        <div className="text-sm text-gray-600">משמרת {shift.shiftType}</div>
                      </div>
                    </div>
                    {shift.tasks && shift.tasks.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {shift.tasks.map((task, index) => (
                          <span key={index} className={`px-2 py-1 rounded-full text-xs font-medium ${getTaskColor(task)}`}>
                            <i className={`${getTaskIcon(task)} mr-1`}></i>
                            {task}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <i className="fas fa-calendar"></i>
                    <span>{shift.date}</span>
                    <i className="fas fa-clock ml-2"></i>
                    <span>{shift.shiftType}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <i className="fas fa-calendar-times text-gray-400 text-2xl"></i>
              </div>
              <h3 className="text-lg font-semibold text-gray-700 mb-2">אין משמרות השבוע</h3>
              <p className="text-gray-500">לא שובצת למשמרות השבוע הנוכחי</p>
            </div>
          )}
        </div>

        {/* Summary */}
        {shifts.length > 0 && (
          <div className="bg-purple-50 border-t border-purple-200 p-4">
            <div className="flex items-center justify-between text-sm">
              <div className="text-purple-700">
                <i className="fas fa-chart-bar mr-2"></i>
                סה"כ משמרות: {shifts.length}
              </div>
              <div className="text-purple-700">
                <i className="fas fa-tasks mr-2"></i>
                משימות: {shifts.reduce((total, shift) => total + (shift.tasks?.length || 0), 0)}
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="bg-gray-50 px-6 py-4 flex justify-end">
          <Button onClick={closeModal} className="bg-purple-600 hover:bg-purple-700">
            סגור
          </Button>
        </div>
      </div>
    </div>
  )
}
