import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full">
        <h1 className="text-3xl font-bold text-gray-800 mb-4 text-center">
          Shift Scheduler
        </h1>
        <p className="text-gray-600 mb-6 text-center">
          Welcome to the Shift Scheduler application!
        </p>
        
        <div className="space-y-4">
          <Link 
            href="/dashboard" 
            className="w-full bg-blue-600 text-white py-3 px-4 rounded-md hover:bg-blue-700 text-center block"
          >
            Enter Dashboard
          </Link>
          
          <div className="text-sm text-gray-500 space-y-1">
            <p>Backend: https://shift-scheduler-anao.onrender.com</p>
            <p>Status: Connected ✅</p>
          </div>
        </div>
      </div>
    </div>
  );
}
