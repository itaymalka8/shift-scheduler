'use client'

import { useRequestsStore } from '@/store/requests-store'
import { useEmployeesStore } from '@/store/employees-store'

export function RequestsPanel() {
  const { requests, approveRequest, denyRequest, deleteRequest } = useRequestsStore()
  const { employees } = useEmployeesStore()

  if (requests.length === 0) {
    return (
      <div className="space-y-3 flex-grow overflow-y-auto pr-2">
        <p className="text-slate-400 text-center text-sm">אין בקשות חדשות.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3 flex-grow overflow-y-auto pr-2">
      {requests.map((req) => {
        const employee = employees.find((e) => e.id === req.employeeId)
        const isRange = req.startDate !== req.endDate
        const dateDisplay = isRange 
          ? `${formatDate(new Date(req.startDate + 'T00:00:00'))} - ${formatDate(new Date(req.endDate + 'T00:00:00'))}`
          : formatDate(new Date(req.startDate + 'T00:00:00'))

        return (
          <div key={req.id} className="p-3 rounded-lg bg-slate-700 border border-slate-600 text-sm">
            <div className="flex justify-between items-start">
              <div>
                <p className="font-bold text-slate-100">{employee?.name || 'עובד לא ידוע'}</p>
                <p className="text-slate-300">{dateDisplay} - {req.requestType}</p>
                {req.reason && (
                  <p className="text-xs italic text-slate-400 mt-1">"{req.reason}"</p>
                )}
                <p className="text-xs text-slate-400 mt-1">
                  {req.status === 'ממתין לאישור' ? '⏳ ממתין לאישור' : 
                   req.status === 'אושר' ? '✅ אושר' : '❌ נדחה'}
                </p>
              </div>
            </div>
            {req.status === 'ממתין לאישור' && (
              <div className="flex justify-end space-x-2 space-x-reverse mt-2">
                <button
                  onClick={() => denyRequest(req.id)}
                  className="text-red-400 hover:text-red-300 font-bold"
                >
                  דחה
                </button>
                <button
                  onClick={() => approveRequest(req.id)}
                  className="text-green-400 hover:text-green-300 font-bold"
                >
                  אשר
                </button>
              </div>
            )}
            {(req.status === 'אושר' || req.status === 'נדחה') && (
              <div className="flex justify-end space-x-2 space-x-reverse mt-2">
                <button
                  onClick={() => deleteRequest(req.id)}
                  className="text-gray-400 hover:text-gray-300 font-bold"
                >
                  הסר
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function formatDate(date: Date) {
  return date.toLocaleString('he-IL', { day: '2-digit', month: '2-digit' })
}
