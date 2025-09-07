import { create } from 'zustand'

interface I18nState {
  direction: 'rtl' | 'ltr'
  toggleDirection: () => void
}

export const useI18n = create<I18nState>((set) => ({
  direction: 'rtl',
  toggleDirection: () => set((state) => ({ direction: state.direction === 'rtl' ? 'ltr' : 'rtl' }))
}))

export const getDirectionClass = (direction: 'rtl' | 'ltr') => {
  return direction === 'rtl' ? 'rtl' : 'ltr'
}
