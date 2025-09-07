'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useModalStore } from '@/store/modal-store'
import { useRequestsStore } from '@/store/requests-store'
import { useEmployeesStore } from '@/store/employees-store'
import { useLoadingStore } from '@/store/loading-store'

export function RequestModal() {
  const { activeModal, closeModal } = useModalStore()
  const { requests, addRequest, approveRequest, denyRequest, deleteRequest } = useRequestsStore()
  const { employees } = useEmployeesStore()
  const { setLoading } = useLoadingStore()
  
  const [isAdding, setIsAdding] = useState(false)
  const [formData, setFormData] = useState({ 
    employeeId: '', 
    requestType: 'חופשה' as 'חופשה' | 'מילואים' | 'מחלה' | 'לימודים' | 'קורס' | 'אחר',
    startDate: '',
    endDate: '',
    reason: '',
    customType: ''
  })

  if (activeModal !== 'request') return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.employeeId || !formData.startDate || !formData.endDate) return

    setLoading(true)
    try {
      await addRequest({
        employeeId: formData.employeeId,
        requestType: formData.customType || formData.requestType,
        startDate: formData.startDate,
        endDate: formData.endDate,
        reason: formData.reason,
        status: 'ממתין לאישור'
      })
      setFormData({ 
        employeeId: '', 
        requestType: 'חופשה', 
        startDate: '', 
        endDate: '', 
        reason: '',
        customType: ''
      })
      setIsAdding(false)
    } catch (error) {
      console.error('Error saving request:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleApprove = async (requestId: string) => {
    setLoading(true)
    try {
      await approveRequest(requestId)
    } catch (error) {
      console.error('Error approving request:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleDeny = async (requestId: string) => {
    setLoading(true)
    try {
      await denyRequest(requestId)
    } catch (error) {
      console.error('Error denying request:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (requestId: string) => {
    if (!confirm('האם אתה בטוח שברצונך למחוק בקשה זו?')) return
    
    setLoading(true)
    try {
      await deleteRequest(requestId)
    } catch (error) {
      console.error('Error deleting request:', error)
    } finally {
      setLoading(false)
    }
  }

  const getStatusColor = (status: string) => {
    switch(status) {
      case 'ממתין לאישור': return 'text-yellow-600'
      case 'אושר': return 'text-green-600'
      case 'נדחה': return 'text-red-600'
      default: return 'text-slate-600'
    }
  }

  const getStatusIcon = (status: string) => {
    switch(status) {
      case 'ממתין לאישור': return '⏳'
      case 'אושר': return '✅'
      case 'נדחה': return '❌'
      default: return '📋'
    }
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00')
    return date.toLocaleString('he-IL', { 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric' 
    })
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[10001] p-2 sm:p-4 animate-in fade-in-0 duration-300">
      <div className="bg-white rounded-2xl shadow-2xl p-4 sm:p-6 w-full max-w-4xl max-h-[95vh] sm:max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-300">
        <div className="flex justify-between items-center mb-4 sm:mb-6 border-b border-slate-200 pb-3 sm:pb-4">
          <div className="flex items-center gap-2 sm:gap-3">
            <div 
              onClick={closeModal}
              className="modal-icon-close w-8 h-8 sm:w-10 sm:h-10 bg-purple-100 rounded-full flex items-center justify-center"
            >
              <i className="fas fa-clipboard-list text-purple-600 text-base sm:text-lg"></i>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-700">בקשות עובדים</h2>
          </div>
          <button
            onClick={closeModal}
            className="w-8 h-8 sm:w-10 sm:h-10 bg-slate-100 hover:bg-slate-200 rounded-full flex items-center justify-center text-slate-600 hover:text-slate-800 transition-all duration-200 text-sm sm:text-lg"
          >
            <i className="fas fa-times"></i>
          </button>
        </div>

        {/* Add Request Form */}
        {isAdding && (
          <div className="mb-6 p-4 bg-slate-50 rounded-lg">
            <h3 className="text-lg font-semibold mb-4">הוסף בקשה חדשה</h3>
            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="request-employee">עובד</Label>
                <select
                  id="request-employee"
                  value={formData.employeeId}
                  onChange={(e) => setFormData({ ...formData, employeeId: e.target.value })}
                  className="w-full p-2 border border-slate-300 rounded-md"
                  required
                >
                  <option value="">בחר עובד</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} - {emp.role}
                    </option>
                  ))}
                </select>
              </div>
              
              <div>
                <Label htmlFor="request-type">סוג בקשה</Label>
                <select
                  id="request-type"
                  value={formData.requestType}
                  onChange={(e) => setFormData({ ...formData, requestType: e.target.value as any })}
                  className="w-full p-2 border border-slate-300 rounded-md"
                >
                  <option value="חופשה">חופשה</option>
                  <option value="מילואים">מילואים</option>
                  <option value="מחלה">מחלה</option>
                  <option value="לימודים">לימודים</option>
                  <option value="קורס">קורס</option>
                  <option value="אחר">אחר</option>
                </select>
              </div>

              {formData.requestType === 'אחר' && (
                <div className="md:col-span-2">
                  <Label htmlFor="custom-type">סוג בקשה מותאם</Label>
                  <Input
                    id="custom-type"
                    value={formData.customType}
                    onChange={(e) => setFormData({ ...formData, customType: e.target.value })}
                    placeholder="הכנס סוג בקשה מותאם"
                  />
                </div>
              )}

              <div>
                <Label htmlFor="start-date">תאריך התחלה</Label>
                <Input
                  id="start-date"
                  type="date"
                  value={formData.startDate}
                  onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                  required
                />
              </div>

              <div>
                <Label htmlFor="end-date">תאריך סיום</Label>
                <Input
                  id="end-date"
                  type="date"
                  value={formData.endDate}
                  onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                  required
                />
              </div>

              <div className="md:col-span-2">
                <Label htmlFor="request-reason">סיבת הבקשה</Label>
                <Input
                  id="request-reason"
                  value={formData.reason}
                  onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                  placeholder="פרט את סיבת הבקשה"
                />
              </div>

              <div className="md:col-span-2 flex gap-2">
                <Button type="submit" className="bg-blue-600 hover:bg-blue-700">
                  שלח בקשה
                </Button>
                <Button 
                  type="button" 
                  variant="outline"
                  onClick={() => {
                    setIsAdding(false)
                    setFormData({ 
                      employeeId: '', 
                      requestType: 'חופשה', 
                      startDate: '', 
                      endDate: '', 
                      reason: '',
                      customType: ''
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
              className="bg-teal-600 hover:bg-teal-700"
            >
              <i className="fas fa-plus ml-2"></i>הוסף בקשה חדשה
            </Button>
          </div>
        )}

        {/* Requests List */}
        <div className="space-y-4">
          {requests.map((request) => {
            const employee = employees.find((e) => e.id === request.employeeId)
            return (
              <div 
                key={request.id} 
                className="p-4 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center">
                    <span className="mr-3 text-lg">{getStatusIcon(request.status)}</span>
                    <div>
                      <h3 className="font-semibold text-lg">
                        {employee?.name || 'עובד לא ידוע'}
                      </h3>
                      <p className="text-sm text-slate-600">
                        {employee?.role} | {request.requestType}
                      </p>
                      <p className="text-sm text-slate-500">
                        {formatDate(request.startDate)} - {formatDate(request.endDate)}
                      </p>
                      {request.reason && (
                        <p className="text-sm text-slate-600 mt-1">"{request.reason}"</p>
                      )}
                    </div>
                  </div>
                                     <div className="flex gap-2">
                     {request.status === 'ממתין לאישור' && (
                       <>
                         <Button
                           onClick={() => handleApprove(request.id)}
                           size="sm"
                           className="bg-green-600 hover:bg-green-700 text-white"
                         >
                           <i className="fas fa-check ml-1"></i>אשר
                         </Button>
                         <Button
                           onClick={() => handleDeny(request.id)}
                           size="sm"
                           className="bg-red-600 hover:bg-red-700 text-white"
                         >
                           <i className="fas fa-times ml-1"></i>דחה
                         </Button>
                       </>
                     )}
                     {(request.status === 'אושר' || request.status === 'נדחה') && (
                       <Button
                         onClick={() => handleDelete(request.id)}
                         size="sm"
                         className="bg-gray-600 hover:bg-gray-700 text-white"
                       >
                         <i className="fas fa-trash ml-1"></i>הסר
                       </Button>
                     )}
                     <span className={`text-sm font-medium ${getStatusColor(request.status)}`}>
                       {request.status}
                     </span>
                   </div>
                </div>
              </div>
            )
          })}
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
