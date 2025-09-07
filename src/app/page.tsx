export default function Home() {
  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <div className="bg-white p-8 rounded-lg shadow-md">
        <h1 className="text-3xl font-bold text-gray-800 mb-4">
          Shift Scheduler
        </h1>
        <p className="text-gray-600 mb-6">
          Welcome to the Shift Scheduler application!
        </p>
        <div className="space-y-2">
          <p className="text-sm text-gray-500">Backend: https://shift-scheduler-anao.onrender.com</p>
          <p className="text-sm text-gray-500">Status: Connected ✅</p>
        </div>
      </div>
    </div>
  );
}
