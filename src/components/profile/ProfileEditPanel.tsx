import { useState, useEffect, useRef } from 'react'
import api from '../../lib/api'

interface ProfileData {
  id: string
  username: string
  display_name: string
  avatar_url: string | null
  cover_image_url: string | null
  bio: string | null
  location: string | null
  website: string | null
  social_twitter: string | null
  social_instagram: string | null
  social_tiktok: string | null
  show_designs: boolean
  show_reviews: boolean
  show_activity: boolean
  allow_messages: boolean
}

interface ProfileEditPanelProps {
  isOpen: boolean
  onClose: () => void
  profile: ProfileData
  onProfileUpdated: (updatedProfile: ProfileData) => void
}

export function ProfileEditPanel({
  isOpen,
  onClose,
  profile,
  onProfileUpdated
}: ProfileEditPanelProps) {
  const [formData, setFormData] = useState<ProfileData>(profile)
  const [saving, setSaving] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [uploadingCover, setUploadingCover] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const coverInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setFormData(profile)
  }, [profile])

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [isOpen, onClose])

  // Prevent body scroll when panel is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  const handleImageUpload = async (file: File, type: 'avatar' | 'cover') => {
    const setUploading = type === 'avatar' ? setUploadingAvatar : setUploadingCover

    try {
      setUploading(true)

      // Convert to base64
      const reader = new FileReader()
      const base64Promise = new Promise<string>((resolve) => {
        reader.onload = () => resolve(reader.result as string)
        reader.readAsDataURL(file)
      })
      const base64 = await base64Promise

      // Upload via API
      const response = await api.post('/api/profile/upload-image', {
        image: base64,
        type
      })

      if (response.data.url) {
        const field = type === 'avatar' ? 'avatar_url' : 'cover_image_url'
        setFormData(prev => ({ ...prev, [field]: response.data.url }))
      }
    } catch (error) {
      console.error(`Failed to upload ${type}:`, error)
    } finally {
      setUploading(false)
    }
  }

  const handleSave = async () => {
    try {
      setSaving(true)

      const response = await api.post('/api/profile/update', {
        display_name: formData.display_name,
        username: formData.username,
        bio: formData.bio,
        location: formData.location,
        website: formData.website,
        avatar_url: formData.avatar_url,
        cover_image_url: formData.cover_image_url,
        social_twitter: formData.social_twitter,
        social_instagram: formData.social_instagram,
        social_tiktok: formData.social_tiktok,
        show_designs: formData.show_designs,
        show_reviews: formData.show_reviews,
        show_activity: formData.show_activity,
        allow_messages: formData.allow_messages
      })

      if (response.data.profile) {
        onProfileUpdated(response.data.profile)
        onClose()
      }
    } catch (error) {
      console.error('Failed to save profile:', error)
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-lg bg-white shadow-2xl z-50 overflow-hidden flex flex-col animate-slide-in-right">
        {/* Header */}
        <div className="flex-shrink-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-display font-bold text-slate-900">Edit Profile</h2>
            <p className="text-sm text-slate-500 mt-0.5">Update your profile information</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-6 space-y-8">
            {/* Avatar & Cover Upload */}
            <section className="space-y-5">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Photos</h3>

              {/* Avatar */}
              <div className="flex items-center gap-5">
                <div className="relative">
                  <div className="w-24 h-24 rounded-full overflow-hidden bg-gradient-to-br from-purple-100 to-pink-100 border-2 border-slate-200">
                    {formData.avatar_url ? (
                      <img src={formData.avatar_url} alt="Avatar" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <span className="text-3xl text-purple-400 font-display font-bold">
                          {formData.display_name?.[0]?.toUpperCase() || '?'}
                        </span>
                      </div>
                    )}
                  </div>
                  {uploadingAvatar && (
                    <div className="absolute inset-0 rounded-full bg-white/80 flex items-center justify-center">
                      <div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && handleImageUpload(e.target.files[0], 'avatar')}
                  />
                  <button
                    onClick={() => avatarInputRef.current?.click()}
                    disabled={uploadingAvatar}
                    className="px-4 py-2 text-sm font-medium bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors disabled:opacity-50"
                  >
                    Change Photo
                  </button>
                  <p className="text-xs text-slate-400 mt-1.5">JPG, PNG or GIF. Max 5MB.</p>
                </div>
              </div>

              {/* Cover Image */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Cover Photo</label>
                <div className="relative h-32 rounded-xl overflow-hidden bg-gradient-to-br from-purple-50 to-pink-50 border-2 border-dashed border-slate-200 hover:border-purple-300 transition-colors">
                  {formData.cover_image_url ? (
                    <img src={formData.cover_image_url} alt="Cover" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-slate-400">
                      <svg className="w-8 h-8 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <span className="text-xs">No cover image</span>
                    </div>
                  )}
                  {uploadingCover && (
                    <div className="absolute inset-0 bg-white/80 flex items-center justify-center">
                      <div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                  <input
                    ref={coverInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && handleImageUpload(e.target.files[0], 'cover')}
                  />
                  <button
                    onClick={() => coverInputRef.current?.click()}
                    disabled={uploadingCover}
                    className="absolute bottom-2 right-2 px-3 py-1.5 text-xs font-medium bg-white/90 backdrop-blur-sm rounded-lg text-slate-700 hover:bg-white shadow-sm transition-colors disabled:opacity-50"
                  >
                    {formData.cover_image_url ? 'Change' : 'Upload'}
                  </button>
                </div>
                <p className="text-xs text-slate-400 mt-1.5">Leave empty to auto-generate from your designs</p>
              </div>
            </section>

            {/* Basic Info */}
            <section className="space-y-4">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Basic Info</h3>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Display Name</label>
                <input
                  type="text"
                  value={formData.display_name || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, display_name: e.target.value }))}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-colors"
                  placeholder="Your name"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Username</label>
                <div className="flex items-stretch">
                  <span className="px-3 py-2.5 bg-slate-100 border border-r-0 border-slate-200 rounded-l-xl text-slate-500 text-sm flex items-center">@</span>
                  <input
                    type="text"
                    value={formData.username || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, username: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') }))}
                    className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-r-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-colors"
                    placeholder="username"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Bio</label>
                <textarea
                  value={formData.bio || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, bio: e.target.value }))}
                  rows={3}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-colors resize-none"
                  placeholder="Tell people about yourself..."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Location</label>
                  <input
                    type="text"
                    value={formData.location || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-colors"
                    placeholder="City"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Website</label>
                  <input
                    type="text"
                    value={formData.website || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, website: e.target.value }))}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-colors"
                    placeholder="yoursite.com"
                  />
                </div>
              </div>
            </section>

            {/* Social Links */}
            <section className="space-y-4">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Social Links</h3>

              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 text-slate-600" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                    </svg>
                  </div>
                  <input
                    type="text"
                    value={formData.social_twitter || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, social_twitter: e.target.value }))}
                    className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-colors"
                    placeholder="twitter.com/username"
                  />
                </div>

                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-pink-100 to-purple-100 flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 text-pink-600" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                    </svg>
                  </div>
                  <input
                    type="text"
                    value={formData.social_instagram || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, social_instagram: e.target.value }))}
                    className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-colors"
                    placeholder="instagram.com/username"
                  />
                </div>

                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-slate-900 flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z"/>
                    </svg>
                  </div>
                  <input
                    type="text"
                    value={formData.social_tiktok || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, social_tiktok: e.target.value }))}
                    className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-colors"
                    placeholder="tiktok.com/@username"
                  />
                </div>
              </div>
            </section>

            {/* Privacy Settings */}
            <section className="space-y-4">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Privacy</h3>

              <div className="space-y-3">
                <label className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 hover:bg-slate-100 cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    checked={formData.show_designs ?? true}
                    onChange={(e) => setFormData(prev => ({ ...prev, show_designs: e.target.checked }))}
                    className="mt-0.5 w-5 h-5 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                  />
                  <div>
                    <span className="text-sm font-medium text-slate-900">Show my designs publicly</span>
                    <p className="text-xs text-slate-500 mt-0.5">Others can see your designs on your profile</p>
                  </div>
                </label>

                <label className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 hover:bg-slate-100 cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    checked={formData.show_reviews ?? true}
                    onChange={(e) => setFormData(prev => ({ ...prev, show_reviews: e.target.checked }))}
                    className="mt-0.5 w-5 h-5 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                  />
                  <div>
                    <span className="text-sm font-medium text-slate-900">Show my reviews publicly</span>
                    <p className="text-xs text-slate-500 mt-0.5">Others can see reviews you've written</p>
                  </div>
                </label>

                <label className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 hover:bg-slate-100 cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    checked={formData.show_activity ?? false}
                    onChange={(e) => setFormData(prev => ({ ...prev, show_activity: e.target.checked }))}
                    className="mt-0.5 w-5 h-5 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                  />
                  <div>
                    <span className="text-sm font-medium text-slate-900">Show activity on my profile</span>
                    <p className="text-xs text-slate-500 mt-0.5">Display recent activity feed to visitors</p>
                  </div>
                </label>

                <label className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 hover:bg-slate-100 cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    checked={formData.allow_messages ?? false}
                    onChange={(e) => setFormData(prev => ({ ...prev, allow_messages: e.target.checked }))}
                    className="mt-0.5 w-5 h-5 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                  />
                  <div>
                    <span className="text-sm font-medium text-slate-900">Allow others to message me</span>
                    <p className="text-xs text-slate-500 mt-0.5">Enable direct messages from other users</p>
                  </div>
                </label>
              </div>
            </section>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex-shrink-0 bg-slate-50 border-t border-slate-200 px-6 py-4 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-700 font-medium hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 btn-primary !rounded-xl disabled:opacity-50"
          >
            {saving ? (
              <span className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Saving...
              </span>
            ) : (
              'Save Changes'
            )}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes slide-in-right {
          from { transform: translateX(100%); opacity: 0.5; }
          to { transform: translateX(0); opacity: 1; }
        }
        .animate-slide-in-right {
          animation: slide-in-right 0.3s ease-out;
        }
      `}</style>
    </>
  )
}
