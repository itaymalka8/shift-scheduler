'use client'

import { useState } from 'react'
import { useScheduleStore } from '@/store/schedule-store'
import { useEmployeesStore } from '@/store/employees-store'
import { useModalStore } from '@/store/modal-store'

interface TaskCubeProps {
  task: string
  date: string
}

export function TaskCube({ task, date }: TaskCubeProps) {
  const { getEmployeesByTask } = useScheduleStore()
  const { employees } = useEmployeesStore()
  const { openModal } = useModalStore()
  const [isHovered, setIsHovered] = useState(false)

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

  const getTaskColor = (taskName: string) => {
    const colorMap: { [key: string]: string } = {
      'אמל"ח': 'bg-red-100 text-red-800 border-red-200',
      'סמים': 'bg-purple-100 text-purple-800 border-purple-200',
      'כלכלי': 'fas fa-chart-line',
      'תגבור': 'bg-blue-100 text-blue-800 border-blue-200',
      'פע"ר': 'bg-green-100 text-green-800 border-green-200',
      'צו חיפוש': 'bg-yellow-100 text-yellow-800 border-yellow-200',
      'חקירות': 'bg-indigo-100 text-indigo-800 border-indigo-200',
      'מסע ציד': 'bg-orange-100 text-orange-800 border-orange-200',
      'סיורים': 'bg-teal-100 text-teal-800 border-teal-200',
      'מעקבים': 'bg-pink-100 text-pink-800 border-pink-200',
      'אחר': 'bg-gray-100 text-gray-800 border-gray-200'
    }
    return colorMap[taskName] || 'bg-gray-100 text-gray-800 border-gray-200'
  }

  const employeeIds = getEmployeesByTask(date, task)
  const assignedEmployees = employees.filter(emp => employeeIds.includes(emp.id))

  const handleTaskClick = () => {
    if (assignedEmployees.length > 0) {
      openModal('task-employees', { task, date, employees: assignedEmployees })
    }
  }

  return (
    <div 
      className={`work-plan-activity task-cube ${getTaskColor(task)} cursor-pointer transition-all duration-200 hover:scale-105 hover:shadow-md`}
      onClick={handleTaskClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="flex items-center justify-between w-full">
        <div className="flex items-center gap-2">
          <i className={`${getTaskIcon(task)} activity-icon`}></i>
          <span className="activity-text font-medium">{task}</span>
        </div>
        
        {assignedEmployees.length > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-xs font-bold bg-white/50 px-2 py-1 rounded-full">
              {assignedEmployees.length}
            </span>
            <i className="fas fa-users text-xs"></i>
          </div>
        )}
      </div>
      
      {isHovered && assignedEmployees.length > 0 && (
        <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-2 z-10 min-w-48">
          <div className="text-xs font-semibold text-gray-600 mb-1">עובדים במשימה:</div>
          <div className="space-y-1">
            {assignedEmployees.map(emp => (
              <div key={emp.id} className="text-xs text-gray-700">
                <i className="fas fa-user mr-1"></i>
                {emp.name}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

