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
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-card border-l border-white/10 shadow-2xl z-50 overflow-y-auto animate-slide-in-right">
        {/* Header */}
        <div className="sticky top-0 bg-card/95 backdrop-blur-sm border-b border-white/10 p-4 flex items-center justify-between z-10">
          <h2 className="text-xl font-bold text-white">Edit Profile</h2>
          <button
            onClick={onClose}
            className="p-2 text-muted hover:text-white transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Avatar & Cover Upload */}
          <div className="space-y-4">
            {/* Avatar */}
            <div>
              <label className="block text-sm font-medium text-muted mb-2">Profile Photo</label>
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 rounded-full overflow-hidden bg-white/5 border border-white/10">
                  {formData.avatar_url ? (
                    <img src={formData.avatar_url} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-2xl text-white bg-gradient-to-br from-purple-600 to-pink-600">
                      {formData.display_name?.[0]?.toUpperCase() || '?'}
                    </div>
                  )}
                </div>
                <div>
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
                    className="px-4 py-2 text-sm bg-white/5 border border-white/10 rounded-lg text-white hover:bg-white/10 transition-colors disabled:opacity-50"
                  >
                    {uploadingAvatar ? 'Uploading...' : 'Change Avatar'}
                  </button>
                </div>
              </div>
            </div>

            {/* Cover Image */}
            <div>
              <label className="block text-sm font-medium text-muted mb-2">Cover Photo</label>
              <div className="relative h-28 rounded-xl overflow-hidden bg-white/5 border border-white/10">
                {formData.cover_image_url ? (
                  <img src={formData.cover_image_url} alt="Cover" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted">
                    <span>No cover image</span>
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
                  className="absolute bottom-2 right-2 px-3 py-1.5 text-xs bg-black/60 backdrop-blur-sm rounded-lg text-white hover:bg-black/80 transition-colors disabled:opacity-50"
                >
                  {uploadingCover ? 'Uploading...' : 'Change Cover'}
                </button>
              </div>
              <p className="text-xs text-muted mt-1">Leave empty to auto-generate from your designs</p>
            </div>
          </div>

          {/* Basic Info */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-muted uppercase tracking-wide">Basic Info</h3>

            <div>
              <label className="block text-sm font-medium text-white mb-1">Display Name</label>
              <input
                type="text"
                value={formData.display_name || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, display_name: e.target.value }))}
                className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-purple-500"
                placeholder="Your name"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-white mb-1">Username</label>
              <div className="flex items-center">
                <span className="px-3 py-2 bg-white/5 border border-r-0 border-white/10 rounded-l-lg text-muted">@</span>
                <input
                  type="text"
                  value={formData.username || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, username: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') }))}
                  className="flex-1 px-4 py-2 bg-white/5 border border-white/10 rounded-r-lg text-white focus:outline-none focus:border-purple-500"
                  placeholder="username"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-white mb-1">Bio</label>
              <textarea
                value={formData.bio || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, bio: e.target.value }))}
                rows={3}
                className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-purple-500 resize-none"
                placeholder="Tell people about yourself..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-white mb-1">Location</label>
              <input
                type="text"
                value={formData.location || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
                className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-purple-500"
                placeholder="City, Country"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-white mb-1">Website</label>
              <input
                type="text"
                value={formData.website || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, website: e.target.value }))}
                className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-purple-500"
                placeholder="https://yoursite.com"
              />
            </div>
          </div>

          {/* Social Links */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-muted uppercase tracking-wide">Social Links</h3>

            <div>
              <label className="block text-sm font-medium text-white mb-1">Twitter / X</label>
              <input
                type="text"
                value={formData.social_twitter || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, social_twitter: e.target.value }))}
                className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-purple-500"
                placeholder="https://twitter.com/username"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-white mb-1">Instagram</label>
              <input
                type="text"
                value={formData.social_instagram || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, social_instagram: e.target.value }))}
                className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-purple-500"
                placeholder="https://instagram.com/username"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-white mb-1">TikTok</label>
              <input
                type="text"
                value={formData.social_tiktok || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, social_tiktok: e.target.value }))}
                className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-purple-500"
                placeholder="https://tiktok.com/@username"
              />
            </div>
          </div>

          {/* Privacy Settings */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-muted uppercase tracking-wide">Privacy Settings</h3>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.show_designs ?? true}
                onChange={(e) => setFormData(prev => ({ ...prev, show_designs: e.target.checked }))}
                className="w-5 h-5 rounded border-white/20 bg-white/5 text-purple-600 focus:ring-purple-500"
              />
              <div>
                <span className="text-white">Show my designs publicly</span>
                <p className="text-xs text-muted">Others can see your designs on your profile</p>
              </div>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.show_reviews ?? true}
                onChange={(e) => setFormData(prev => ({ ...prev, show_reviews: e.target.checked }))}
                className="w-5 h-5 rounded border-white/20 bg-white/5 text-purple-600 focus:ring-purple-500"
              />
              <div>
                <span className="text-white">Show my reviews publicly</span>
                <p className="text-xs text-muted">Others can see reviews you've written</p>
              </div>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.show_activity ?? false}
                onChange={(e) => setFormData(prev => ({ ...prev, show_activity: e.target.checked }))}
                className="w-5 h-5 rounded border-white/20 bg-white/5 text-purple-600 focus:ring-purple-500"
              />
              <div>
                <span className="text-white">Show activity on my profile</span>
                <p className="text-xs text-muted">Display recent activity feed to visitors</p>
              </div>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.allow_messages ?? false}
                onChange={(e) => setFormData(prev => ({ ...prev, allow_messages: e.target.checked }))}
                className="w-5 h-5 rounded border-white/20 bg-white/5 text-purple-600 focus:ring-purple-500"
              />
              <div>
                <span className="text-white">Allow others to message me</span>
                <p className="text-xs text-muted">Enable direct messages from other users</p>
              </div>
            </label>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="sticky bottom-0 bg-card/95 backdrop-blur-sm border-t border-white/10 p-4 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-4 py-2.5 bg-purple-600 rounded-lg text-white font-medium hover:bg-purple-500 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes slide-in-right {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .animate-slide-in-right {
          animation: slide-in-right 0.3s ease-out;
        }
      `}</style>
    </>
  )
}
