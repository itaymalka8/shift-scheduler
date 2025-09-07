'use client'

import { AssignmentModal } from '@/components/assignment-modal'
import { EmployeesListModal } from '@/components/employees-list-modal'
import { VehicleListModal } from '@/components/vehicle-list-modal'
import { WorkPlanModal } from '@/components/work-plan-modal'
import { RequestModal } from '@/components/request-modal'
import { SummaryModal } from '@/components/summary-modal'
import { DayAssignmentModal } from '@/components/day-assignment-modal'
import { TaskEmployeesModal } from '@/components/task-employees-modal'
import { MyScheduleModal } from '@/components/my-schedule-modal'
import { PersonalScheduleModal } from '@/components/personal-schedule-modal'
import { useModalStore } from '@/store/modal-store'

export function ModalContainer() {
  const { activeModal } = useModalStore()

  return (
    <>
      {activeModal === 'assignment' && <AssignmentModal />}
      {activeModal === 'employees-list' && <EmployeesListModal />}
      {activeModal === 'vehicle-list' && <VehicleListModal />}
      {activeModal === 'work-plan' && <WorkPlanModal />}
      {activeModal === 'request' && <RequestModal />}
      {activeModal === 'summary' && <SummaryModal />}
      {activeModal === 'day-assignment' && <DayAssignmentModal />}
      {activeModal === 'task-employees' && <TaskEmployeesModal />}
      {activeModal === 'my-schedule' && <MyScheduleModal />}
      {activeModal === 'personal-schedule' && <PersonalScheduleModal />}
      {/* Add other modals here as needed */}
    </>
  )
}
