import type { UserProfile } from '../types'

const API_BASE_URL = '/api'

// Get authentication token from localStorage
const getAuthToken = (): string | null => {
  return localStorage.getItem('auth_token')
}

// Create headers with authentication
const getHeaders = (): Record<string, string> => {
  const token = getAuthToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  
  return headers
}

export const profileService = {
  // Get user profile by username or userId
  async getProfile(identifier: { username?: string; userId?: string }): Promise<UserProfile | null> {
    try {
      const params = new URLSearchParams()
      if (identifier.username) params.append('username', identifier.username)
      if (identifier.userId) params.append('userId', identifier.userId)
      
      const response = await fetch(`${API_BASE_URL}/profile/get?${params}`, {
        method: 'GET',
        headers: getHeaders()
      })
      
      if (!response.ok) {
        if (response.status === 404) {
          return null
        }
        throw new Error(`Failed to fetch profile: ${response.statusText}`)
      }
      
      return await response.json()
    } catch (error) {
      console.error('Error fetching profile:', error)
      throw error
    }
  },

  // Update user profile
  async updateProfile(profileData: Partial<UserProfile>): Promise<void> {
    try {
      const response = await fetch(`${API_BASE_URL}/profile/update`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(profileData)
      })
      
      if (!response.ok) {
        throw new Error(`Failed to update profile: ${response.statusText}`)
      }
    } catch (error) {
      console.error('Error updating profile:', error)
      throw error
    }
  }
}
