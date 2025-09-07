'use client'

import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useModalStore } from '@/store/modal-store'
import { useWorkPlanStore } from '@/store/work-plan-store'
import { useLoadingStore } from '@/store/loading-store'

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

const SHIFT_TYPES = [
  { key: 'morning', name: 'משמרת בוקר', icon: '🌅' },
  { key: 'afternoon', name: 'משמרת צהריים', icon: '☀️' },
  { key: 'evening', name: 'משמרת ערב', icon: '🌙' }
]

export function WorkPlanModal() {
  const { activeModal, modalData, closeModal } = useModalStore()
  const { workPlans, addWorkPlan, updateWorkPlan, deleteWorkPlan } = useWorkPlanStore()
  const { setLoading } = useLoadingStore()
  
  const [isAdding, setIsAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState({ 
    date: '', 
    generalTasks: [] as string[], // משימות כלליות ללא שיוך
    shiftTasks: {
      morning: [] as string[],
      afternoon: [] as string[],
      evening: [] as string[]
    },
    notes: '',
    customTask: '',
    startTime: '08:00',
    endTime: '16:00'
  })

  if (activeModal !== 'work-plan') return null

  // Auto-fill date if provided in modalData
  React.useEffect(() => {
    if (modalData && modalData.date) {
      setFormData(prev => ({ ...prev, date: modalData.date }))
    }
  }, [modalData])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.date) return

    setLoading(true)
    try {
      if (editingId) {
        await updateWorkPlan(editingId, {
          date: formData.date,
          generalTasks: formData.generalTasks,
          shiftTasks: formData.shiftTasks,
          notes: formData.notes,
          startTime: formData.startTime,
          endTime: formData.endTime
        })
        setEditingId(null)
      } else {
        await addWorkPlan({
          date: formData.date,
          generalTasks: formData.generalTasks,
          shiftTasks: formData.shiftTasks,
          notes: formData.notes,
          startTime: formData.startTime,
          endTime: formData.endTime
        })
      }
      setFormData({ 
        date: '', 
        generalTasks: [], 
        shiftTasks: { morning: [], afternoon: [], evening: [] },
        notes: '', 
        customTask: '',
        startTime: '08:00',
        endTime: '16:00'
      })
      setIsAdding(false)
    } catch (error) {
      console.error('Error saving work plan:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (workPlan: any) => {
    setEditingId(workPlan.id)
    setFormData({ 
      date: workPlan.date, 
      generalTasks: workPlan.generalTasks || [], 
      shiftTasks: workPlan.shiftTasks || {
        morning: [],
        afternoon: [],
        evening: []
      },
      notes: workPlan.notes || '',
      customTask: '',
      startTime: workPlan.startTime || '08:00',
      endTime: workPlan.endTime || '16:00'
    })
    setIsAdding(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('האם אתה בטוח שברצונך למחוק תכנון עבודה זה?')) return
    
    setLoading(true)
    try {
      await deleteWorkPlan(id)
    } catch (error) {
      console.error('Error deleting work plan:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleGeneralTaskToggle = (task: string) => {
    setFormData(prev => ({
      ...prev,
      generalTasks: prev.generalTasks.includes(task)
        ? prev.generalTasks.filter(t => t !== task)
        : [...prev.generalTasks, task]
    }))
  }

  const handleShiftTaskToggle = (shift: 'morning' | 'afternoon' | 'evening', task: string) => {
    setFormData(prev => ({
      ...prev,
      shiftTasks: {
        ...prev.shiftTasks,
        [shift]: prev.shiftTasks[shift].includes(task)
          ? prev.shiftTasks[shift].filter(t => t !== task)
          : [...prev.shiftTasks[shift], task]
      }
    }))
  }

  const getShiftName = (shift: string) => {
    const shiftNames = {
      morning: 'משמרת בוקר',
      afternoon: 'משמרת צהריים',
      evening: 'משמרת ערב'
    }
    return shiftNames[shift as keyof typeof shiftNames] || shift
  }

  const addCustomTask = () => {
    if (formData.customTask.trim()) {
      setFormData(prev => ({
        ...prev,
        generalTasks: [...prev.generalTasks, prev.customTask.trim()],
        customTask: ''
      }))
    }
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00')
    return date.toLocaleString('he-IL', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    })
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[10001] p-2 sm:p-4 animate-in fade-in-0 duration-300">
      <div className="bg-white rounded-2xl shadow-2xl p-4 sm:p-6 w-full max-w-4xl max-h-[95vh] sm:max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-300">
        <div className="flex justify-between items-center mb-4 sm:mb-6 border-b border-slate-200 pb-3 sm:pb-4">
          <div className="flex items-center gap-2 sm:gap-3">
            <div 
              onClick={closeModal}
              className="modal-icon-close w-8 h-8 sm:w-10 sm:h-10 bg-orange-100 rounded-full flex items-center justify-center"
            >
              <i className="fas fa-tasks text-orange-600 text-base sm:text-lg"></i>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-700">תכנון עבודה</h2>
          </div>
          <button
            onClick={closeModal}
            className="w-8 h-8 sm:w-10 sm:h-10 bg-slate-100 hover:bg-slate-200 rounded-full flex items-center justify-center text-slate-600 hover:text-slate-800 transition-all duration-200 text-sm sm:text-lg"
          >
            <i className="fas fa-times"></i>
          </button>
        </div>

        {/* Add/Edit Form */}
        {isAdding && (
          <div className="mb-6 p-4 bg-slate-50 rounded-lg">
            <h3 className="text-lg font-semibold mb-4">
              {editingId ? 'ערוך תכנון עבודה' : 'הוסף תכנון עבודה חדש'}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <Label htmlFor="work-plan-date">תאריך</Label>
                    <Input
                      id="work-plan-date"
                      type="date"
                      value={formData.date}
                      onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                      required
                    />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="start-time">שעת התחלה</Label>
                      <Input
                        id="start-time"
                        type="time"
                        value={formData.startTime}
                        onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="end-time">שעת סיום</Label>
                      <Input
                        id="end-time"
                        type="time"
                        value={formData.endTime}
                        onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                        required
                      />
                    </div>
                  </div>
              
              <div>
                <Label>משימות כלליות (ללא שיוך לשוטרים)</Label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2">
                  {ACTIVITY_OPTIONS.map((task) => (
                    <label key={task} className="flex items-center space-x-2 space-x-reverse">
                      <input
                        type="checkbox"
                        checked={formData.generalTasks.includes(task)}
                        onChange={() => handleGeneralTaskToggle(task)}
                        className="rounded"
                      />
                      <span className="text-sm">{task}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <Label>משימות לפי משמרות (עם שיוך לשוטרים)</Label>
                <div className="space-y-4 mt-2">
                  {SHIFT_TYPES.map((shift) => (
                    <div key={shift.key} className="border rounded-lg p-3 bg-slate-50">
                      <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                        <span>{shift.icon}</span>
                        {shift.name}
                      </h4>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        {ACTIVITY_OPTIONS.map((task) => (
                          <label key={task} className="flex items-center space-x-2 space-x-reverse">
                            <input
                              type="checkbox"
                              checked={formData.shiftTasks[shift.key as keyof typeof formData.shiftTasks].includes(task)}
                              onChange={() => handleShiftTaskToggle(shift.key as keyof typeof formData.shiftTasks, task)}
                              className="rounded"
                            />
                            <span className="text-xs">{task}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <Label>משימה מותאמת אישית</Label>
                <div className="flex gap-2 mt-2">
                  <Input
                    value={formData.customTask}
                    onChange={(e) => setFormData({ ...formData, customTask: e.target.value })}
                    placeholder="הוסף משימה מותאמת"
                    onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addCustomTask())}
                  />
                  <Button type="button" onClick={addCustomTask} variant="outline">
                    הוסף
                  </Button>
                </div>
              </div>

              <div>
                <Label htmlFor="work-plan-notes">הערות</Label>
                <Input
                  id="work-plan-notes"
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="הערות נוספות (אופציונלי)"
                />
              </div>

              {formData.generalTasks.length > 0 && (
                <div>
                  <Label>משימות כלליות נבחרות:</Label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {formData.generalTasks.map((task) => (
                      <span 
                        key={task}
                        className="bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-sm flex items-center gap-1"
                      >
                        {task}
                        <button
                          type="button"
                          onClick={() => handleGeneralTaskToggle(task)}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {(formData.shiftTasks.morning.length > 0 || formData.shiftTasks.afternoon.length > 0 || formData.shiftTasks.evening.length > 0) && (
                <div>
                  <Label>משימות לפי משמרות נבחרות:</Label>
                  <div className="space-y-2 mt-2">
                    {SHIFT_TYPES.map((shift) => {
                      const tasks = formData.shiftTasks[shift.key as keyof typeof formData.shiftTasks]
                      if (tasks.length === 0) return null
                      
                      return (
                        <div key={shift.key} className="bg-slate-50 p-2 rounded">
                          <div className="text-sm font-semibold mb-1 flex items-center gap-1">
                            <span>{shift.icon}</span>
                            {shift.name}
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {tasks.map((task) => (
                              <span 
                                key={task}
                                className="bg-green-100 text-green-800 px-2 py-1 rounded-full text-xs flex items-center gap-1"
                              >
                                {task}
                                <button
                                  type="button"
                                  onClick={() => handleShiftTaskToggle(shift.key as keyof typeof formData.shiftTasks, task)}
                                  className="text-green-600 hover:text-green-800"
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <Button type="submit" className="bg-blue-600 hover:bg-blue-700">
                  {editingId ? 'עדכן' : 'הוסף'}
                </Button>
                <Button 
                  type="button" 
                  variant="outline"
                  onClick={() => {
                    setIsAdding(false)
                    setEditingId(null)
                    setFormData({ 
                      date: '', 
                      generalTasks: [],
                      shiftTasks: {
                        morning: [],
                        afternoon: [],
                        evening: []
                      },
                      notes: '', 
                      customTask: '',
                      startTime: '08:00',
                      endTime: '16:00'
                    })
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
              className="bg-orange-600 hover:bg-orange-700"
            >
              <i className="fas fa-plus ml-2"></i>הוסף תכנון עבודה חדש
            </Button>
          </div>
        )}

        {/* Work Plans List */}
        <div className="space-y-4">
          {Object.values(workPlans).map((workPlan) => (
            <div 
              key={workPlan.id} 
              className="p-4 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
            >
                                 <div className="flex justify-between items-start mb-3">
                     <div>
                       <h3 className="font-semibold text-lg">{formatDate(workPlan.date)}</h3>
                       <p className="text-sm text-slate-600">
                         {workPlan.startTime} - {workPlan.endTime}
                       </p>
                       {workPlan.notes && (
                         <p className="text-sm text-slate-600 mt-1">"{workPlan.notes}"</p>
                       )}
                     </div>
                <div className="flex gap-2">
                  <Button
                    onClick={() => handleEdit(workPlan)}
                    variant="outline"
                    size="sm"
                    className="text-blue-600 hover:text-blue-700"
                  >
                    <i className="fas fa-edit"></i>
                  </Button>
                  <Button
                    onClick={() => handleDelete(workPlan.id)}
                    variant="outline"
                    size="sm"
                    className="text-red-600 hover:text-red-700"
                  >
                    <i className="fas fa-trash"></i>
                  </Button>
                </div>
              </div>
              
              <div className="flex flex-wrap gap-2">
                {[...workPlan.generalTasks, ...workPlan.shiftTasks.morning, ...workPlan.shiftTasks.afternoon, ...workPlan.shiftTasks.evening].map((activity) => (
                  <span 
                    key={activity}
                    className="bg-orange-100 text-orange-800 px-3 py-1 rounded-full text-sm font-medium"
                  >
                    {activity}
                  </span>
                ))}
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
