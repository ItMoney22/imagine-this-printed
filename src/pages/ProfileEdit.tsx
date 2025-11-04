import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
import { useNavigate } from 'react-router-dom'
import { profileService } from '../utils/profile-service'
import type { UserProfile } from '../types'

const ProfileEdit: React.FC = () => {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [profile, setProfile] = useState<Partial<UserProfile>>({
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
    showOrderHistory: false,
    showDesigns: true,
    showModels: true
  })
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [_profileImage, setProfileImage] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string>('')

  useEffect(() => {
    if (user) {
      loadUserProfile()
    }
  }, [user])

  const loadUserProfile = async () => {
    try {
      setIsLoading(true)
      
      if (!user) {
        throw new Error('User not authenticated')
      }

      // Load profile using API service
      const userProfile = await profileService.getProfile({ userId: user.id })

      if (userProfile) {
        // Convert to component format
        const loadedProfile: Partial<UserProfile> = {
          username: userProfile.username,
          displayName: userProfile.displayName,
          bio: userProfile.bio || '',
          location: userProfile.location || '',
          website: userProfile.website || '',
          socialLinks: userProfile.socialLinks || {
            twitter: '',
            instagram: '',
            linkedin: ''
          },
          isPublic: userProfile.isPublic,
          showOrderHistory: userProfile.showOrderHistory,
          showDesigns: userProfile.showDesigns,
          showModels: userProfile.showModels,
          profileImage: userProfile.profileImage
        }
        
        setProfile(loadedProfile)
        if (userProfile.profileImage) {
          setPreviewUrl(userProfile.profileImage)
        }
      } else {
        // Create default profile if none exists
        const defaultProfile: Partial<UserProfile> = {
          username: user.username || '',
          displayName: user.displayName || 'User',
          bio: '',
          location: '',
          website: '',
          socialLinks: {
            twitter: '',
            instagram: '',
            linkedin: ''
          },
          isPublic: true,
          showOrderHistory: false,
          showDesigns: true,
          showModels: true
        }
        
        setProfile(defaultProfile)
      }
    } catch (error) {
      console.error('Error loading profile:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleInputChange = (field: string, value: any) => {
    if (field.includes('.')) {
      const [parent, child] = field.split('.')
      setProfile(prev => ({
        ...prev,
        [parent]: {
          ...(prev[parent as keyof typeof prev] as any),
          [child]: value
        }
      }))
    } else {
      setProfile(prev => ({
        ...prev,
        [field]: value
      }))
    }
  }

  const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      setProfileImage(file)
      const url = URL.createObjectURL(file)
      setPreviewUrl(url)
    }
  }

  const saveProfile = async () => {
    try {
      setIsSaving(true)
      
      if (!user) {
        throw new Error('User not authenticated')
      }

      // Prepare profile data for API call
      const profileData = {
        username: profile.username,
        displayName: profile.displayName,
        bio: profile.bio || '',
        location: profile.location || '',
        website: profile.website || '',
        socialLinks: profile.socialLinks || {},
        avatarUrl: previewUrl || null,
        isPublic: profile.isPublic,
        showOrderHistory: profile.showOrderHistory,
        showDesigns: profile.showDesigns,
        showModels: profile.showModels
      }

      // Update profile using API service
      await profileService.updateProfile(profileData)
      
      alert('Profile updated successfully!')
      navigate('/account/profile')
    } catch (error) {
      console.error('Error saving profile:', error)
      alert('Failed to save profile. Please try again.')
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

      <div className="bg-card rounded-lg shadow">
        <div className="px-6 py-4 border-b card-border">
          <h3 className="text-lg font-medium text-text">Profile Information</h3>
        </div>
        
        <div className="p-6 space-y-6">
          {/* Profile Image */}
          <div>
            <label className="block text-sm font-medium text-text mb-2">
              Profile Picture
            </label>
            <div className="flex items-center space-x-6">
              <div className="w-24 h-24 rounded-full overflow-hidden bg-card">
                <img
                  src={previewUrl || 'https://via.placeholder.com/96x96?text=Profile'}
                  alt="Profile"
                  className="w-full h-full object-cover"
                />
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
                  className="btn-secondary cursor-pointer"
                >
                  Upload Photo
                </label>
                <p className="text-sm text-muted mt-1">JPG, PNG up to 5MB</p>
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
                value={profile.username || ''}
                onChange={(e) => handleInputChange('username', e.target.value)}
                className="form-input w-full"
                placeholder="johndoe"
              />
              <p className="text-sm text-muted mt-1">Your unique username for public profile URL</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-text mb-2">
                Display Name *
              </label>
              <input
                type="text"
                value={profile.displayName || ''}
                onChange={(e) => handleInputChange('displayName', e.target.value)}
                className="form-input w-full"
                placeholder="John Doe"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-text mb-2">
                Bio
              </label>
              <textarea
                value={profile.bio || ''}
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
                value={profile.location || ''}
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
                value={profile.website || ''}
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
                  value={profile.socialLinks?.twitter || ''}
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
                  value={profile.socialLinks?.instagram || ''}
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
                  value={profile.socialLinks?.linkedin || ''}
                  onChange={(e) => handleInputChange('socialLinks.linkedin', e.target.value)}
                  className="form-input w-full"
                  placeholder="https://linkedin.com/in/username"
                />
              </div>
            </div>
          </div>

          {/* Privacy Settings */}
          <div>
            <h4 className="text-lg font-medium text-text mb-4">Privacy Settings</h4>
            <div className="space-y-4">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={profile.isPublic || false}
                  onChange={(e) => handleInputChange('isPublic', e.target.checked)}
                  className="form-checkbox"
                />
                <span className="ml-2 text-sm text-text">
                  Make my profile public (others can view your profile)
                </span>
              </label>

              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={profile.showOrderHistory || false}
                  onChange={(e) => handleInputChange('showOrderHistory', e.target.checked)}
                  className="form-checkbox"
                />
                <span className="ml-2 text-sm text-text">
                  Show my order history on public profile
                </span>
              </label>

              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={profile.showDesigns || false}
                  onChange={(e) => handleInputChange('showDesigns', e.target.checked)}
                  className="form-checkbox"
                />
                <span className="ml-2 text-sm text-text">
                  Show my designs on public profile
                </span>
              </label>

              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={profile.showModels || false}
                  onChange={(e) => handleInputChange('showModels', e.target.checked)}
                  className="form-checkbox"
                />
                <span className="ml-2 text-sm text-text">
                  Show my 3D models on public profile
                </span>
              </label>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t card-border flex items-center justify-between">
          <button
            onClick={() => navigate('/account/profile')}
            className="btn-secondary"
          >
            Cancel
          </button>
          <div className="flex items-center space-x-3">
            {profile.username && (
              <a
                href={`/profile/${profile.username}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-purple-600 hover:text-purple-700"
              >
                Preview Public Profile →
              </a>
            )}
            <button
              onClick={saveProfile}
              disabled={isSaving || !profile.username || !profile.displayName}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? 'Saving...' : 'Save Profile'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ProfileEdit