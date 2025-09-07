'use client'

import { useState } from 'react'
import { useModalStore } from '@/store/modal-store'
import { useWorkPlanStore } from '@/store/work-plan-store'

interface TaskManagerProps {
  date: string
  shiftType: 'morning' | 'afternoon' | 'evening'
  tasks: string[]
  onTasksChange: (tasks: string[]) => void
}

const ACTIVITY_OPTIONS = [
  'אמל"ח',
  'סמים', 
  'כלכלי',
  'תגבור',
  'פע"ר',
  'צו חיפוש',
  'חקירות',
  'מסע ציד',
  'סיורים',
  'מעקבים',
  'אחר'
]

export function TaskManager({ date, shiftType, tasks, onTasksChange }: TaskManagerProps) {
  const [isAdding, setIsAdding] = useState(false)
  const [newTask, setNewTask] = useState('')

  const handleAddTask = () => {
    if (newTask.trim() && !tasks.includes(newTask.trim())) {
      onTasksChange([...tasks, newTask.trim()])
      setNewTask('')
      setIsAdding(false)
    }
  }

  const handleRemoveTask = (taskToRemove: string) => {
    onTasksChange(tasks.filter(task => task !== taskToRemove))
  }

  const handleSelectFromOptions = (task: string) => {
    if (!tasks.includes(task)) {
      onTasksChange([...tasks, task])
    }
    setIsAdding(false)
  }

  return (
    <div className="space-y-2">
      {/* משימות קיימות */}
      {tasks.map((task, index) => (
        <div
          key={index}
          className="flex items-center justify-between bg-white/80 p-2 rounded-lg border border-gray-300"
        >
          <span className="text-xs text-slate-800">{task}</span>
          <button
            onClick={() => handleRemoveTask(task)}
            className="text-red-500 hover:text-red-700 text-xs p-1"
            title="הסר משימה"
          >
            <i className="fas fa-times"></i>
          </button>
        </div>
      ))}

      {/* הוספת משימה חדשה */}
      {isAdding ? (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              placeholder="הקלד משימה חדשה"
              className="flex-1 text-xs p-2 border border-gray-300 rounded"
              onKeyPress={(e) => e.key === 'Enter' && handleAddTask()}
            />
            <button
              onClick={handleAddTask}
              className="bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded text-xs"
            >
              <i className="fas fa-plus"></i>
            </button>
          </div>
          
          {/* אפשרויות מהירות */}
          <div className="grid grid-cols-2 gap-1">
            {ACTIVITY_OPTIONS.map((option) => (
              <button
                key={option}
                onClick={() => handleSelectFromOptions(option)}
                disabled={tasks.includes(option)}
                className={`text-xs p-1 rounded border ${
                  tasks.includes(option)
                    ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                    : 'bg-blue-100 hover:bg-blue-200 text-blue-800'
                }`}
              >
                {option}
              </button>
            ))}
          </div>
          
          <div className="flex gap-2">
            <button
              onClick={() => setIsAdding(false)}
              className="bg-gray-500 hover:bg-gray-600 text-white px-2 py-1 rounded text-xs"
            >
              ביטול
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setIsAdding(true)}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded text-xs flex items-center justify-center gap-1"
        >
          <i className="fas fa-plus"></i>
          הוסף משימה
        </button>
      )}
    </div>
  )
}

