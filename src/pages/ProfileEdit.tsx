import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { apiFetch } from '../lib/api'

const ProfileEdit: React.FC = () => {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [formData, setFormData] = useState({
    username: '',
    displayName: '',
    bio: '',
    location: '',
    website: '',
    socialLinks: {
      twitter: '',
      instagram: '',
      linkedin: ''
    },
    isPublic: true,
    // Shipping address
    shippingAddressLine1: '',
    shippingAddressLine2: '',
    shippingCity: '',
    shippingState: '',
    shippingZip: '',
    shippingCountry: 'US',
    shippingPhone: ''
  })

  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [profileImage, setProfileImage] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (user) {
      loadUserProfile()
    }
  }, [user])

  const loadUserProfile = async () => {
    try {
      setIsLoading(true)
      setError(null)

      if (!user) {
        throw new Error('User not authenticated')
      }

      console.log('[ProfileEdit] Loading profile for user:', user.id)

      // Load profile from Supabase
      const { data: userProfile, error: profileError } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', user.id)
        .single()

      if (profileError) {
        console.error('[ProfileEdit] Error loading profile:', profileError)
        throw profileError
      }

      console.log('[ProfileEdit] Profile loaded:', userProfile)

      // Map to form data
      setFormData({
        username: userProfile.username || '',
        displayName: userProfile.display_name || userProfile.username || '',
        bio: userProfile.bio || '',
        location: userProfile.location || '',
        website: userProfile.website || '',
        socialLinks: userProfile.social_links || {
          twitter: '',
          instagram: '',
          linkedin: ''
        },
        isPublic: userProfile.is_public !== false,
        // Shipping address
        shippingAddressLine1: userProfile.shipping_address_line1 || '',
        shippingAddressLine2: userProfile.shipping_address_line2 || '',
        shippingCity: userProfile.shipping_city || '',
        shippingState: userProfile.shipping_state || '',
        shippingZip: userProfile.shipping_zip || '',
        shippingCountry: userProfile.shipping_country || 'US',
        shippingPhone: userProfile.shipping_phone || ''
      })

      if (userProfile.avatar_url) {
        setPreviewUrl(userProfile.avatar_url)
      }
    } catch (error: any) {
      console.error('[ProfileEdit] Error loading profile:', error)
      setError('Failed to load profile: ' + error.message)
    } finally {
      setIsLoading(false)
    }
  }

  const handleInputChange = (field: string, value: any) => {
    if (field.includes('.')) {
      const [parent, child] = field.split('.')
      setFormData(prev => ({
        ...prev,
        [parent]: {
          ...(prev[parent as keyof typeof prev] as any),
          [child]: value
        }
      }))
    } else {
      setFormData(prev => ({
        ...prev,
        [field]: value
      }))
    }
  }

  const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      // Validate file size (5MB max)
      if (file.size > 5 * 1024 * 1024) {
        setError('Image must be less than 5MB')
        return
      }

      // Validate file type
      if (!file.type.startsWith('image/')) {
        setError('Please select an image file')
        return
      }

      setProfileImage(file)
      const url = URL.createObjectURL(file)
      setPreviewUrl(url)
      setError(null)
    }
  }

  const convertImageToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => {
        const result = reader.result as string
        resolve(result)
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  const saveProfile = async () => {
    try {
      setIsSaving(true)
      setError(null)

      if (!user) {
        throw new Error('User not authenticated')
      }

      // Validate required fields
      if (!formData.username || !formData.displayName) {
        setError('Username and Display Name are required')
        return
      }

      console.log('[ProfileEdit] Saving profile...')

      // Upload image first if a new one was selected
      let avatarUrl: string | undefined = undefined
      if (profileImage) {
        console.log('[ProfileEdit] Uploading profile image...')
        const imageBase64 = await convertImageToBase64(profileImage)

        // Upload to Supabase Storage via backend API
        const uploadResponse = await apiFetch('/api/profile/upload-image', {
          method: 'POST',
          body: JSON.stringify({
            image: imageBase64,
            type: 'avatar'
          })
        })

        if (uploadResponse.ok && uploadResponse.url) {
          avatarUrl = uploadResponse.url
          console.log('[ProfileEdit] ✅ Image uploaded:', avatarUrl)
        } else {
          throw new Error(uploadResponse.error || 'Failed to upload profile image')
        }
      }

      // Prepare profile data for API call
      const profileData: any = {
        username: formData.username,
        displayName: formData.displayName,
        bio: formData.bio || '',
        location: formData.location || '',
        website: formData.website || '',
        socialTwitter: formData.socialLinks.twitter || '',
        socialInstagram: formData.socialLinks.instagram || '',
        isPublic: formData.isPublic,
        showDesigns: true,
        // Shipping address
        shippingAddressLine1: formData.shippingAddressLine1 || '',
        shippingAddressLine2: formData.shippingAddressLine2 || '',
        shippingCity: formData.shippingCity || '',
        shippingState: formData.shippingState || '',
        shippingZip: formData.shippingZip || '',
        shippingCountry: formData.shippingCountry || 'US',
        shippingPhone: formData.shippingPhone || ''
      }

      // Only include avatar_url if we uploaded a new image
      if (avatarUrl) {
        profileData.avatarUrl = avatarUrl
      }

      console.log('[ProfileEdit] Sending update request...')

      // Update profile using backend API
      const response = await apiFetch('/api/profile/update', {
        method: 'POST',
        body: JSON.stringify(profileData)
      })

      if (response.ok) {
        console.log('[ProfileEdit] ✅ Profile updated successfully')
        alert('Profile updated successfully!')
        navigate('/account/profile')
      } else {
        throw new Error(response.error || 'Failed to update profile')
      }
    } catch (error: any) {
      console.error('[ProfileEdit] Error saving profile:', error)
      setError('Failed to save profile: ' + (error.response?.data?.error || error.message))
    } finally {
      setIsSaving(false)
    }
  }

  if (!user) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
          <p className="text-yellow-800">Please sign in to edit your profile.</p>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-text">Edit Profile</h1>
        <p className="text-muted">Manage your public profile information</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-6">
          <p className="text-red-800">{error}</p>
        </div>
      )}

      <div className="bg-card rounded-lg shadow">
        <div className="px-6 py-4 border-b border-border">
          <h3 className="text-lg font-medium text-text">Profile Information</h3>
        </div>

        <div className="p-6 space-y-6">
          {/* Profile Image */}
          <div>
            <label className="block text-sm font-medium text-text mb-2">
              Profile Picture
            </label>
            <div className="flex items-center space-x-6">
              <div className="w-24 h-24 rounded-full overflow-hidden bg-secondary border-2 border-border">
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt="Profile"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-4xl text-muted">
                    👤
                  </div>
                )}
              </div>
              <div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageChange}
                  className="hidden"
                  id="profile-image"
                />
                <label
                  htmlFor="profile-image"
                  className="btn-secondary cursor-pointer inline-block"
                >
                  Upload Photo
                </label>
                <p className="text-sm text-muted mt-1">JPG, PNG up to 5MB</p>
                {profileImage && (
                  <p className="text-sm text-green-600 mt-1">
                    ✓ New image selected: {profileImage.name}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Basic Information */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-text mb-2">
                Username *
              </label>
              <input
                type="text"
                value={formData.username}
                onChange={(e) => handleInputChange('username', e.target.value)}
                className="form-input w-full"
                placeholder="johndoe"
                required
              />
              <p className="text-sm text-muted mt-1">Your unique username for public profile URL</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-text mb-2">
                Display Name *
              </label>
              <input
                type="text"
                value={formData.displayName}
                onChange={(e) => handleInputChange('displayName', e.target.value)}
                className="form-input w-full"
                placeholder="John Doe"
                required
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-text mb-2">
                Bio
              </label>
              <textarea
                value={formData.bio}
                onChange={(e) => handleInputChange('bio', e.target.value)}
                rows={3}
                className="form-input w-full"
                placeholder="Tell others about yourself..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text mb-2">
                Location
              </label>
              <input
                type="text"
                value={formData.location}
                onChange={(e) => handleInputChange('location', e.target.value)}
                className="form-input w-full"
                placeholder="San Francisco, CA"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text mb-2">
                Website
              </label>
              <input
                type="url"
                value={formData.website}
                onChange={(e) => handleInputChange('website', e.target.value)}
                className="form-input w-full"
                placeholder="https://yourwebsite.com"
              />
            </div>
          </div>

          {/* Social Links */}
          <div>
            <h4 className="text-lg font-medium text-text mb-4">Social Links</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <label className="block text-sm font-medium text-text mb-2">
                  Twitter
                </label>
                <input
                  type="url"
                  value={formData.socialLinks.twitter}
                  onChange={(e) => handleInputChange('socialLinks.twitter', e.target.value)}
                  className="form-input w-full"
                  placeholder="https://twitter.com/username"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text mb-2">
                  Instagram
                </label>
                <input
                  type="url"
                  value={formData.socialLinks.instagram}
                  onChange={(e) => handleInputChange('socialLinks.instagram', e.target.value)}
                  className="form-input w-full"
                  placeholder="https://instagram.com/username"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text mb-2">
                  LinkedIn
                </label>
                <input
                  type="url"
                  value={formData.socialLinks.linkedin}
                  onChange={(e) => handleInputChange('socialLinks.linkedin', e.target.value)}
                  className="form-input w-full"
                  placeholder="https://linkedin.com/in/username"
                />
              </div>
            </div>
          </div>

          {/* Shipping Address */}
          <div>
            <h4 className="text-lg font-medium text-text mb-4">Default Shipping Address</h4>
            <p className="text-sm text-muted mb-4">This address will be pre-filled during checkout to save you time.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-text mb-2">
                  Address Line 1
                </label>
                <input
                  type="text"
                  value={formData.shippingAddressLine1}
                  onChange={(e) => handleInputChange('shippingAddressLine1', e.target.value)}
                  className="form-input w-full"
                  placeholder="123 Main Street"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-text mb-2">
                  Address Line 2 <span className="text-muted">(Optional)</span>
                </label>
                <input
                  type="text"
                  value={formData.shippingAddressLine2}
                  onChange={(e) => handleInputChange('shippingAddressLine2', e.target.value)}
                  className="form-input w-full"
                  placeholder="Apt, Suite, Unit, etc."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text mb-2">
                  City
                </label>
                <input
                  type="text"
                  value={formData.shippingCity}
                  onChange={(e) => handleInputChange('shippingCity', e.target.value)}
                  className="form-input w-full"
                  placeholder="City"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text mb-2">
                  State
                </label>
                <input
                  type="text"
                  value={formData.shippingState}
                  onChange={(e) => handleInputChange('shippingState', e.target.value)}
                  className="form-input w-full"
                  placeholder="GA"
                  maxLength={2}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text mb-2">
                  ZIP Code
                </label>
                <input
                  type="text"
                  value={formData.shippingZip}
                  onChange={(e) => handleInputChange('shippingZip', e.target.value)}
                  className="form-input w-full"
                  placeholder="30301"
                  maxLength={10}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text mb-2">
                  Phone
                </label>
                <input
                  type="tel"
                  value={formData.shippingPhone}
                  onChange={(e) => handleInputChange('shippingPhone', e.target.value)}
                  className="form-input w-full"
                  placeholder="(555) 123-4567"
                />
              </div>
            </div>
          </div>

          {/* Privacy Settings */}
          <div>
            <h4 className="text-lg font-medium text-text mb-4">Privacy Settings</h4>
            <div className="space-y-4">
              <label className="flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.isPublic}
                  onChange={(e) => handleInputChange('isPublic', e.target.checked)}
                  className="form-checkbox h-5 w-5 text-primary border-border rounded focus:ring-primary focus:ring-offset-0"
                />
                <span className="ml-3 text-sm text-text">
                  Make my profile public (others can view your profile)
                </span>
              </label>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-border flex items-center justify-between bg-secondary/20">
          <button
            onClick={() => navigate('/account/profile')}
            className="btn-secondary"
            disabled={isSaving}
          >
            Cancel
          </button>
          <div className="flex items-center space-x-3">
            {formData.username && (
              <a
                href={`/profile/${formData.username}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:text-primary/80 font-medium"
              >
                Preview Public Profile →
              </a>
            )}
            <button
              onClick={saveProfile}
              disabled={isSaving || !formData.username || !formData.displayName}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? (
                <span className="flex items-center">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Saving...
                </span>
              ) : (
                'Save Profile'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ProfileEdit

