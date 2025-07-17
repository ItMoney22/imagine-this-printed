// Frontend-safe authentication service that uses API endpoints

export interface User {
  id: string
  email: string
  role: string
  username: string
  displayName?: string
  firstName?: string
  lastName?: string
  emailVerified: boolean
  profileCompleted: boolean
  wallet?: {
    pointsBalance: number
    itcBalance: number
  }
}

export interface AuthResponse {
  user?: User
  token?: string
  error?: string
}

export const authenticateUser = async (email: string, password: string): Promise<AuthResponse> => {
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    })

    const data = await response.json()

    if (!response.ok) {
      return { error: data.error || 'Authentication failed' }
    }

    return { user: data.user, token: data.token }
  } catch (error) {
    console.error('Authentication error:', error)
    return { error: 'Network error occurred' }
  }
}

export const createUser = async (email: string, password: string, userData?: any): Promise<AuthResponse> => {
  try {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        email, 
        password, 
        username: userData?.username || email.split('@')[0],
        ...userData 
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      return { error: data.error || 'Registration failed' }
    }

    return { user: data.user, token: data.token }
  } catch (error) {
    console.error('Registration error:', error)
    return { error: 'Network error occurred' }
  }
}

export const getUserFromToken = async (token: string): Promise<User | null> => {
  try {
    const response = await fetch('/api/auth/me', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      return null
    }

    const data = await response.json()
    return data.user
  } catch (error) {
    console.error('Get user error:', error)
    return null
  }
}

export const sendPasswordResetEmail = async (email: string): Promise<{ error?: string }> => {
  try {
    const response = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
    })

    const data = await response.json()

    if (!response.ok) {
      return { error: data.error || 'Password reset failed' }
    }

    return {}
  } catch (error) {
    console.error('Password reset error:', error)
    return { error: 'Network error occurred' }
  }
}