import { create } from 'zustand'

interface ModalState {
  activeModal: string | null
  modalData: any
  openModal: (modalType: string, data?: any) => void
  closeModal: () => void
}

export const useModalStore = create<ModalState>((set) => ({
  activeModal: null,
  modalData: null,
  openModal: (modalType, data) => set({ activeModal: modalType, modalData: data }),
  closeModal: () => set({ activeModal: null, modalData: null })
}))

