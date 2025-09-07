export default function Dashboard() {
  return (
    <div className="min-h-screen bg-gray-100">
      <div className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <h1 className="text-3xl font-bold text-gray-900">Shift Scheduler</h1>
            <div className="flex space-x-4">
              <button className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700">
                Add Shift
              </button>
              <button className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700">
                Add Employee
              </button>
            </div>
          </div>
        </div>
      </div>
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Today's Shifts</h3>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span>Morning Shift</span>
                <span className="text-green-600">3 employees</span>
              </div>
              <div className="flex justify-between">
                <span>Afternoon Shift</span>
                <span className="text-blue-600">2 employees</span>
              </div>
              <div className="flex justify-between">
                <span>Evening Shift</span>
                <span className="text-purple-600">1 employee</span>
              </div>
            </div>
          </div>
          
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Employees</h3>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span>Total Employees</span>
                <span className="text-gray-600">15</span>
              </div>
              <div className="flex justify-between">
                <span>Active Today</span>
                <span className="text-green-600">12</span>
              </div>
              <div className="flex justify-between">
                <span>On Leave</span>
                <span className="text-red-600">3</span>
              </div>
            </div>
          </div>
          
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Vehicles</h3>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span>Total Vehicles</span>
                <span className="text-gray-600">8</span>
              </div>
              <div className="flex justify-between">
                <span>Available</span>
                <span className="text-green-600">6</span>
              </div>
              <div className="flex justify-between">
                <span>In Use</span>
                <span className="text-blue-600">2</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
