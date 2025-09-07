'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useModalStore } from '@/store/modal-store'
import { useVehiclesStore } from '@/store/vehicles-store'
import { useLoadingStore } from '@/store/loading-store'

export function VehicleListModal() {
  const { activeModal, closeModal } = useModalStore()
  const { vehicles, addVehicle, updateVehicle, deleteVehicle } = useVehiclesStore()
  const { setLoading } = useLoadingStore()
  
  const [isAdding, setIsAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState({ 
    number: '', 
    km: 0, 
    status: 'תקין' as 'תקין' | 'דורש טיפול' | 'במוסך',
    notes: '' 
  })

  if (activeModal !== 'vehicle-list') return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.number) return

    setLoading(true)
    try {
      if (editingId) {
        await updateVehicle(editingId, formData)
        setEditingId(null)
      } else {
        await addVehicle(formData)
      }
      setFormData({ number: '', km: 0, status: 'תקין', notes: '' })
      setIsAdding(false)
    } catch (error) {
      console.error('Error saving vehicle:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (vehicle: any) => {
    setEditingId(vehicle.id)
    setFormData({ 
      number: vehicle.number, 
      km: vehicle.km, 
      status: vehicle.status, 
      notes: vehicle.notes || '' 
    })
    setIsAdding(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('האם אתה בטוח שברצונך למחוק רכב זה?')) return
    
    setLoading(true)
    try {
      await deleteVehicle(id)
    } catch (error) {
      console.error('Error deleting vehicle:', error)
    } finally {
      setLoading(false)
    }
  }

  const getStatusColor = (status: string) => {
    switch(status) {
      case 'תקין': return 'text-green-600'
      case 'דורש טיפול': return 'text-yellow-600'
      case 'במוסך': return 'text-red-600'
      default: return 'text-slate-600'
    }
  }

  const getStatusIcon = (status: string) => {
    switch(status) {
      case 'תקין': return '✅'
      case 'דורש טיפול': return '⚠️'
      case 'במוסך': return '🔧'
      default: return '🚗'
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[10001] p-2 sm:p-4 animate-in fade-in-0 duration-300">
      <div className="bg-white rounded-2xl shadow-2xl p-4 sm:p-6 w-full max-w-4xl max-h-[95vh] sm:max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-300">
        <div className="flex justify-between items-center mb-4 sm:mb-6 border-b border-slate-200 pb-3 sm:pb-4">
          <div className="flex items-center gap-2 sm:gap-3">
            <div 
              onClick={closeModal}
              className="modal-icon-close w-8 h-8 sm:w-10 sm:h-10 bg-green-100 rounded-full flex items-center justify-center"
            >
              <i className="fas fa-car text-green-600 text-base sm:text-lg"></i>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-700">ניהול רכבים</h2>
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
              {editingId ? 'ערוך רכב' : 'הוסף רכב חדש'}
            </h3>
            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="vehicle-number">מספר רכב</Label>
                <Input
                  id="vehicle-number"
                  value={formData.number}
                  onChange={(e) => setFormData({ ...formData, number: e.target.value })}
                  placeholder="מספר רכב"
                  required
                />
              </div>
              <div>
                <Label htmlFor="vehicle-km">קילומטראז'</Label>
                <Input
                  id="vehicle-km"
                  type="number"
                  value={formData.km}
                  onChange={(e) => setFormData({ ...formData, km: parseInt(e.target.value) || 0 })}
                  placeholder="קילומטראז'"
                  required
                />
              </div>
              <div>
                <Label htmlFor="vehicle-status">סטטוס</Label>
                <select
                  id="vehicle-status"
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                  className="w-full p-2 border border-slate-300 rounded-md"
                >
                  <option value="תקין">תקין</option>
                  <option value="דורש טיפול">דורש טיפול</option>
                  <option value="במוסך">במוסך</option>
                </select>
              </div>
              <div>
                <Label htmlFor="vehicle-notes">הערות</Label>
                <Input
                  id="vehicle-notes"
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="הערות (אופציונלי)"
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
                    setFormData({ number: '', km: 0, status: 'תקין', notes: '' })
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
              <i className="fas fa-plus ml-2"></i>הוסף רכב חדש
            </Button>
          </div>
        )}

        {/* Vehicles List */}
        <div className="space-y-2">
          {vehicles.map((vehicle) => (
            <div 
              key={vehicle.id} 
              className="flex items-center justify-between p-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <div className="flex items-center">
                <span className="mr-3 text-lg">{getStatusIcon(vehicle.status)}</span>
                <div>
                  <p className="font-semibold">{vehicle.number}</p>
                  <p className="text-sm text-slate-600">
                    ק"מ: {vehicle.km.toLocaleString()} | 
                    <span className={`ml-1 ${getStatusColor(vehicle.status)}`}>
                      {vehicle.status}
                    </span>
                  </p>
                  {vehicle.notes && (
                    <p className="text-xs text-slate-500 mt-1">"{vehicle.notes}"</p>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() => handleEdit(vehicle)}
                  variant="outline"
                  size="sm"
                  className="text-blue-600 hover:text-blue-700"
                >
                  <i className="fas fa-edit"></i>
                </Button>
                <Button
                  onClick={() => handleDelete(vehicle.id)}
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
