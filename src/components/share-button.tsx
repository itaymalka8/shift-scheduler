'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

export function ShareButton() {
  const [showShareModal, setShowShareModal] = useState(false)
  const [copied, setCopied] = useState(false)

  const shareUrl = typeof window !== 'undefined' ? window.location.href : 'http://localhost:3000'

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'סידור עבודה שבועי',
          text: 'אפליקציה לניהול משמרות עבודה',
          url: shareUrl,
        })
      } catch (error) {
        console.log('Error sharing:', error)
        setShowShareModal(true)
      }
    } else {
      setShowShareModal(true)
    }
  }

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy:', error)
    }
  }

  const shareViaWhatsApp = () => {
    const text = encodeURIComponent('סידור עבודה שבועי - אפליקציה לניהול משמרות עבודה\n' + shareUrl)
    window.open(`https://wa.me/?text=${text}`, '_blank')
  }

  const shareViaTelegram = () => {
    const text = encodeURIComponent('סידור עבודה שבועי - אפליקציה לניהול משמרות עבודה\n' + shareUrl)
    window.open(`https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${text}`, '_blank')
  }

  const openDirectLink = () => {
    window.open(shareUrl, '_blank')
  }

  return (
    <>
      <Button
        onClick={handleShare}
        className="bg-gradient-to-r from-purple-600 to-pink-600 text-white px-4 py-2 rounded-lg hover:from-purple-700 hover:to-pink-700 transition-all duration-300 flex items-center gap-2 shadow-lg hover:shadow-xl transform hover:scale-105"
        title="שתף אפליקציה"
      >
        <i className="fas fa-share-alt"></i>
        <span className="hidden sm:inline">שתף אפליקציה</span>
      </Button>

      {/* Share Modal */}
      {showShareModal && (
                        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[10001] p-4">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-slate-700">שתף אפליקציה</h3>
              <button
                onClick={() => setShowShareModal(false)}
                className="text-slate-400 hover:text-slate-800 text-2xl"
              >
                ×
              </button>
            </div>

            <div className="space-y-4">
              {/* Direct Link Button */}
              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <h4 className="font-semibold text-blue-800 mb-2">🔗 כניסה ישירה לאפליקציה:</h4>
                <Button
                  onClick={openDirectLink}
                  className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2"
                >
                  <i className="fas fa-external-link-alt"></i>
                  פתח אפליקציה
                </Button>
              </div>

              {/* URL Display */}
              <div className="bg-slate-100 p-3 rounded-lg">
                <p className="text-sm text-slate-600 mb-2">כתובת האפליקציה:</p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={shareUrl}
                    readOnly
                    className="flex-1 p-2 border border-slate-300 rounded text-sm"
                  />
                  <Button
                    onClick={copyToClipboard}
                    className="bg-slate-600 text-white px-3 py-2 rounded hover:bg-slate-700"
                    size="sm"
                  >
                    {copied ? 'הועתק!' : 'העתק'}
                  </Button>
                </div>
              </div>

              {/* Share Options */}
              <div className="space-y-3">
                <h4 className="font-semibold text-slate-700">שתף דרך:</h4>
                
                <Button
                  onClick={shareViaWhatsApp}
                  className="w-full bg-green-500 text-white py-3 rounded-lg hover:bg-green-600 flex items-center justify-center gap-2"
                >
                  <i className="fab fa-whatsapp text-xl"></i>
                  WhatsApp
                </Button>

                <Button
                  onClick={shareViaTelegram}
                  className="w-full bg-blue-500 text-white py-3 rounded-lg hover:bg-blue-600 flex items-center justify-center gap-2"
                >
                  <i className="fab fa-telegram text-xl"></i>
                  Telegram
                </Button>

                <Button
                  onClick={() => {
                    navigator.clipboard.writeText(shareUrl)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 2000)
                  }}
                  className="w-full bg-slate-600 text-white py-3 rounded-lg hover:bg-slate-700 flex items-center justify-center gap-2"
                >
                  <i className="fas fa-link"></i>
                  העתק קישור
                </Button>
              </div>

              {/* Instructions */}
              <div className="bg-yellow-50 p-3 rounded-lg border border-yellow-200">
                <h4 className="font-semibold text-yellow-800 mb-1">💡 איך לשתף:</h4>
                <ul className="text-sm text-yellow-700 space-y-1">
                  <li>• לחץ על "פתח אפליקציה" לכניסה ישירה</li>
                  <li>• העתק את הקישור ושלח לחברים</li>
                  <li>• שתף דרך WhatsApp או Telegram</li>
                </ul>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <Button
                onClick={() => setShowShareModal(false)}
                className="bg-slate-600 text-white px-4 py-2 rounded-lg hover:bg-slate-700"
              >
                סגור
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
