'use client'

export function AppLoader() {
  return (
    <div className="fixed inset-0 bg-slate-800 flex flex-col items-center justify-center z-[200]">
      <div className="text-center text-white mb-6">
        <h1 className="text-3xl font-bold animate-fadeIn">ברוכים הבאים</h1>
        <p className="text-xl text-slate-300 animate-fadeIn" style={{ animationDelay: '0.5s' }}>
          למערכת ניהול סידור עבודה של מודיעין בילוש שפט
        </p>
      </div>
      <div className="loader border-t-indigo-400 border-slate-600"></div>
      <p className="text-slate-400 text-sm mt-6 animate-fadeIn" style={{ animationDelay: '1s' }}>
        גרסא 1.0
      </p>
      <footer className="absolute bottom-6 text-slate-500 text-sm">
        &copy; 2025 All rights reserved to Itay Malka
      </footer>
    </div>
  )
}
