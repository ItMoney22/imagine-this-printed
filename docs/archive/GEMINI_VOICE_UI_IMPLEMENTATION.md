# Gemini Implementation Guide: Voice-Guided Product Creation UI/UX

## 🎯 Project Overview

This document provides comprehensive specifications for implementing the **Voice-Guided AI Product Creation System** UI/UX. The backend infrastructure (Minimax voice synthesis, API routes, DTF optimization) is complete. Your task is to build the frontend experience using the existing design system.

---

## 📋 Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Design System Reference](#design-system-reference)
3. [Components to Build](#components-to-build)
4. [Page Structure](#page-structure)
5. [API Integration](#api-integration)
6. [User Flows](#user-flows)
7. [Admin Features](#admin-features)
8. [Technical Requirements](#technical-requirements)
9. [Testing Checklist](#testing-checklist)

---

## 🏗️ Architecture Overview

### Technology Stack
- **React 19** + TypeScript
- **TailwindCSS** with theme system (CSS variables)
- **React Router DOM v7** for navigation
- **Web Speech API** for voice input
- **Axios** for HTTP requests
- **Supabase Auth** for user authentication

### Backend APIs (Already Implemented)
```
POST /api/ai/voice/synthesize     - Generate speech from text
GET  /api/ai/voice/settings        - Get voice settings (admin)
POST /api/ai/voice/settings        - Update voice settings (admin)
POST /api/admin/products/ai/create - Create AI product
GET  /api/admin/products/ai/:id/status - Poll product status
POST /api/admin/products/ai/:id/remove-background
POST /api/admin/products/ai/:id/create-mockups
POST /api/admin/products/ai/:id/regenerate-images
```

---

## 🎨 Design System Reference

### Theme System
All components **MUST** use semantic CSS variable tokens (never hardcoded colors):

```tsx
// ✅ CORRECT - Use semantic tokens
<div className="bg-bg text-text border-primary">
  <button className="bg-primary text-white hover:bg-secondary">

// ❌ WRONG - Never hardcode colors
<div className="bg-gray-900 text-white border-purple-500">
```

### Available Color Tokens
```css
bg          - Main background
card        - Card backgrounds
text        - Primary text
muted       - Secondary text
primary     - Brand color (purple/blue)
secondary   - Accent color (pink/cyan)
accent      - Highlight color (yellow/green)
```

### Custom Effects
```tsx
// Glow effects (theme-aware)
className="shadow-glow"       // Standard glow
className="shadow-glowSm"     // Small glow
className="shadow-glowLg"     // Large glow

// Glow animation
className="animate-glow-pulse"
```

### Fonts
```tsx
// Display/Headers - Poppins
className="font-display font-bold"

// Tech/Monospace - Orbitron
className="font-tech uppercase tracking-wide"
```

### Glass Effect Pattern
```tsx
// Standard glass card
<div className="bg-card/90 backdrop-blur-xl border border-primary/20 rounded-2xl shadow-glowSm p-6">
```

---

## 🧩 Components to Build

### 1. VoiceConversation Component
**Location**: `src/components/VoiceConversation.tsx`

**Purpose**: Handles voice synthesis playback + voice input recognition

**Props**:
```typescript
interface VoiceConversationProps {
  onTextInput: (text: string) => void        // Called when user provides voice/text input
  isListening?: boolean                       // Show listening state
  autoSpeak?: boolean                         // Auto-play AI responses
  className?: string
}
```

**Key Features**:
1. **Voice Synthesis (Text-to-Speech)**:
   - Call `POST /api/ai/voice/synthesize` with AI message text
   - Play returned audio URL using `<audio>` element
   - Show "AI is speaking..." indicator with waveform animation

2. **Voice Recognition (Speech-to-Text)**:
   - Use Web Speech API: `new webkitSpeechRecognition()`
   - Button to toggle listening state
   - Real-time transcript display
   - Confirm transcript before submitting

3. **Visual States**:
   - Idle: Microphone button (muted color)
   - Listening: Pulsing microphone (primary color + glow)
   - Speaking: Animated waveform bars
   - Error: Red border + error message

**Implementation Guide**:

```tsx
import { useState, useEffect, useRef } from 'react'
import axios from 'axios'

export const VoiceConversation = ({ onTextInput, isListening, autoSpeak }: VoiceConversationProps) => {
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const recognitionRef = useRef<any>(null)

  // Initialize Web Speech API
  useEffect(() => {
    if ('webkitSpeechRecognition' in window) {
      const recognition = new (window as any).webkitSpeechRecognition()
      recognition.continuous = false
      recognition.interimResults = true
      recognition.lang = 'en-US'

      recognition.onresult = (event: any) => {
        const current = event.resultIndex
        const transcriptText = event.results[current][0].transcript
        setTranscript(transcriptText)

        if (event.results[current].isFinal) {
          onTextInput(transcriptText)
          setTranscript('')
        }
      }

      recognition.onerror = (event: any) => {
        setError(`Voice recognition error: ${event.error}`)
      }

      recognitionRef.current = recognition
    }
  }, [onTextInput])

  // Start/stop listening
  useEffect(() => {
    if (isListening && recognitionRef.current) {
      recognitionRef.current.start()
    } else if (recognitionRef.current) {
      recognitionRef.current.stop()
    }
  }, [isListening])

  // Synthesize speech from text
  const speak = async (text: string) => {
    setIsSpeaking(true)
    try {
      const { data } = await axios.post('/api/ai/voice/synthesize', { text })

      if (audioRef.current) {
        audioRef.current.src = data.audioUrl
        audioRef.current.play()
      }
    } catch (err: any) {
      setError(`Speech synthesis failed: ${err.message}`)
    } finally {
      setIsSpeaking(false)
    }
  }

  return (
    <div className="bg-card/90 backdrop-blur-xl border border-primary/20 rounded-2xl p-6">
      {/* Waveform animation when speaking */}
      {isSpeaking && (
        <div className="flex items-center justify-center gap-1 mb-4">
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className="w-1 bg-primary rounded-full animate-pulse"
              style={{
                height: `${Math.random() * 40 + 20}px`,
                animationDelay: `${i * 0.1}s`
              }}
            />
          ))}
        </div>
      )}

      {/* Transcript display */}
      {transcript && (
        <div className="bg-bg/50 border border-primary/10 rounded-lg p-4 mb-4">
          <p className="text-muted text-sm mb-1">You said:</p>
          <p className="text-text">{transcript}</p>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 mb-4">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        onEnded={() => setIsSpeaking(false)}
        className="hidden"
      />
    </div>
  )
}
```

**Visual Design Notes**:
- Use glass effect for container
- Waveform bars should be `bg-primary` with staggered `animate-pulse`
- Microphone icon should glow when listening: `shadow-glow animate-glow-pulse`
- Error states use red tint: `bg-red-500/10 border-red-500/50`

---

### 2. VoiceProductForm Component
**Location**: `src/components/VoiceProductForm.tsx`

**Purpose**: Multi-step form with voice guidance for creating products

**Props**:
```typescript
interface VoiceProductFormProps {
  onComplete: (productId: string) => void
}
```

**Steps**:
1. **Product Description** (voice or text)
2. **Image Style Selection** (realistic vs cartoon)
3. **DTF Print Settings** (shirt color, print style)
4. **Generation Progress** (polling status)
5. **Post-Generation Options** (background removal, mockup, etc.)

**State Management**:
```typescript
const [currentStep, setCurrentStep] = useState(1)
const [formData, setFormData] = useState({
  prompt: '',
  imageStyle: 'realistic' as 'realistic' | 'cartoon',
  shirtColor: 'black' as 'black' | 'white' | 'grey' | 'color',
  printStyle: 'dtf' as 'dtf' | 'screen-print',
  background: 'transparent'
})
const [productId, setProductId] = useState<string | null>(null)
const [jobStatus, setJobStatus] = useState<'idle' | 'generating' | 'success' | 'error'>('idle')
```

**AI Dialogue Flow**:

```typescript
const AI_MESSAGES = {
  welcome: "Hi! I'm your AI design assistant. Let's create an amazing product together! What would you like to print?",

  afterPrompt: "That's a great idea! Now, what style would you like for your design?",

  afterImageStyle: "Perfect choice! For the best print quality, I need to know what shirt color you're thinking of.",

  afterDTFSettings: "Excellent! I'm generating your design now. This usually takes about 30 seconds...",

  generationComplete: "Your design is ready! You can now remove the background, create mockups, or publish it to the marketplace.",

  encouragement: [
    "This is looking amazing!",
    "Great choice!",
    "I love where this is going!",
    "You have excellent taste!"
  ]
}
```

**Step 1: Product Description**
```tsx
<div className="space-y-6">
  <div className="bg-secondary/10 border border-secondary/20 rounded-xl p-4">
    <p className="text-text font-display text-lg">
      {AI_MESSAGES.welcome}
    </p>
  </div>

  <VoiceConversation
    onTextInput={(text) => setFormData({ ...formData, prompt: text })}
    isListening={isListening}
    autoSpeak={true}
  />

  {/* Manual text input fallback */}
  <div>
    <label className="block text-muted text-sm mb-2">Or type your idea:</label>
    <textarea
      value={formData.prompt}
      onChange={(e) => setFormData({ ...formData, prompt: e.target.value })}
      className="w-full bg-bg/50 border border-primary/20 rounded-lg p-4 text-text resize-none"
      rows={4}
      placeholder="Example: A fierce dragon breathing neon flames..."
    />
  </div>

  <button
    onClick={() => setCurrentStep(2)}
    disabled={!formData.prompt}
    className="w-full bg-primary text-white font-display py-3 rounded-lg hover:bg-secondary transition-colors disabled:opacity-50"
  >
    Continue to Image Style
  </button>
</div>
```

**Step 2: Image Style Selection**
```tsx
<div className="grid grid-cols-2 gap-4">
  {/* Realistic Option */}
  <button
    onClick={() => setFormData({ ...formData, imageStyle: 'realistic' })}
    className={`
      bg-card/90 backdrop-blur-xl border rounded-xl p-6 text-center transition-all
      ${formData.imageStyle === 'realistic'
        ? 'border-primary shadow-glow'
        : 'border-primary/20 hover:border-primary/40'}
    `}
  >
    <div className="text-4xl mb-3">📷</div>
    <h3 className="font-display text-lg text-text mb-2">Realistic</h3>
    <p className="text-muted text-sm">Photo-quality images with detailed textures</p>
  </button>

  {/* Cartoon Option */}
  <button
    onClick={() => setFormData({ ...formData, imageStyle: 'cartoon' })}
    className={`
      bg-card/90 backdrop-blur-xl border rounded-xl p-6 text-center transition-all
      ${formData.imageStyle === 'cartoon'
        ? 'border-primary shadow-glow'
        : 'border-primary/20 hover:border-primary/40'}
    `}
  >
    <div className="text-4xl mb-3">🎨</div>
    <h3 className="font-display text-lg text-text mb-2">Cartoon</h3>
    <p className="text-muted text-sm">Bold, vibrant illustrations with artistic flair</p>
  </button>
</div>
```

**Step 3: DTF Settings**
```tsx
<div className="space-y-6">
  {/* Shirt Color */}
  <div>
    <label className="block text-text font-display mb-3">Shirt Color</label>
    <div className="grid grid-cols-4 gap-3">
      {[
        { value: 'black', label: 'Black', color: 'bg-black', border: 'border-white/20' },
        { value: 'white', label: 'White', color: 'bg-white', border: 'border-gray-800' },
        { value: 'grey', label: 'Grey', color: 'bg-gray-500', border: 'border-white/20' },
        { value: 'color', label: 'Color', color: 'bg-gradient-to-br from-red-500 via-yellow-500 to-blue-500', border: 'border-white/20' },
      ].map(({ value, label, color, border }) => (
        <button
          key={value}
          onClick={() => setFormData({ ...formData, shirtColor: value as any })}
          className={`
            ${color} ${border} border-2 rounded-lg h-20 flex items-center justify-center transition-all
            ${formData.shirtColor === value ? 'ring-4 ring-primary shadow-glow' : 'opacity-60 hover:opacity-100'}
          `}
        >
          <span className={`font-display text-sm ${value === 'white' ? 'text-gray-800' : 'text-white'}`}>
            {label}
          </span>
        </button>
      ))}
    </div>
  </div>

  {/* Print Style */}
  <div>
    <label className="block text-text font-display mb-3">Print Style</label>
    <div className="grid grid-cols-2 gap-4">
      <button
        onClick={() => setFormData({ ...formData, printStyle: 'dtf' })}
        className={`
          bg-card/90 border rounded-lg p-4 text-left transition-all
          ${formData.printStyle === 'dtf' ? 'border-primary shadow-glow' : 'border-primary/20'}
        `}
      >
        <h4 className="font-display text-text mb-1">DTF Transfer</h4>
        <p className="text-muted text-sm">Best for detailed designs with vibrant colors</p>
      </button>

      <button
        onClick={() => setFormData({ ...formData, printStyle: 'screen-print' })}
        className={`
          bg-card/90 border rounded-lg p-4 text-left transition-all
          ${formData.printStyle === 'screen-print' ? 'border-primary shadow-glow' : 'border-primary/20'}
        `}
      >
        <h4 className="font-display text-text mb-1">Screen Print</h4>
        <p className="text-muted text-sm">Classic method for bold, solid colors</p>
      </button>
    </div>
  </div>
</div>
```

**Step 4: Generation Progress**
```tsx
const [progress, setProgress] = useState(0)

// Poll status endpoint
useEffect(() => {
  if (!productId || jobStatus !== 'generating') return

  const interval = setInterval(async () => {
    const { data } = await axios.get(`/api/admin/products/ai/${productId}/status`)

    const imageJob = data.jobs.find((j: any) => j.type === 'replicate_image')

    if (imageJob?.status === 'succeeded') {
      setJobStatus('success')
      setProgress(100)
    } else if (imageJob?.status === 'failed') {
      setJobStatus('error')
    } else {
      setProgress((prev) => Math.min(prev + 5, 90))
    }
  }, 2000)

  return () => clearInterval(interval)
}, [productId, jobStatus])

return (
  <div className="text-center space-y-6">
    <div className="relative w-32 h-32 mx-auto">
      <svg className="transform -rotate-90 w-32 h-32">
        <circle
          cx="64"
          cy="64"
          r="56"
          stroke="currentColor"
          strokeWidth="8"
          fill="transparent"
          className="text-primary/20"
        />
        <circle
          cx="64"
          cy="64"
          r="56"
          stroke="currentColor"
          strokeWidth="8"
          fill="transparent"
          strokeDasharray={2 * Math.PI * 56}
          strokeDashoffset={2 * Math.PI * 56 * (1 - progress / 100)}
          className="text-primary transition-all duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-2xl font-display text-primary">{progress}%</span>
      </div>
    </div>

    <div>
      <h3 className="font-display text-xl text-text mb-2">Generating Your Design...</h3>
      <p className="text-muted">This usually takes 20-30 seconds</p>
    </div>

    <div className="flex items-center justify-center gap-2">
      <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
      <div className="w-2 h-2 bg-primary rounded-full animate-pulse" style={{ animationDelay: '0.2s' }} />
      <div className="w-2 h-2 bg-primary rounded-full animate-pulse" style={{ animationDelay: '0.4s' }} />
    </div>
  </div>
)
```

**Step 5: Post-Generation Options**
```tsx
<div className="space-y-6">
  {/* Generated Image Preview */}
  <div className="bg-card/90 border border-primary/20 rounded-xl p-4">
    <img
      src={generatedImageUrl}
      alt="Generated design"
      className="w-full rounded-lg"
    />
  </div>

  {/* Action Buttons */}
  <div className="grid grid-cols-2 gap-4">
    <button
      onClick={handleRemoveBackground}
      className="bg-card/90 border border-primary/20 rounded-lg p-4 hover:border-primary/40 transition-all"
    >
      <div className="text-3xl mb-2">🎭</div>
      <h4 className="font-display text-text">Remove Background</h4>
      <p className="text-muted text-sm">Make transparent</p>
    </button>

    <button
      onClick={handleCreateMockups}
      className="bg-card/90 border border-primary/20 rounded-lg p-4 hover:border-primary/40 transition-all"
    >
      <div className="text-3xl mb-2">👕</div>
      <h4 className="font-display text-text">Create Mockups</h4>
      <p className="text-muted text-sm">See on products</p>
    </button>

    <button
      onClick={handleDownloadDTF}
      className="bg-card/90 border border-primary/20 rounded-lg p-4 hover:border-primary/40 transition-all"
    >
      <div className="text-3xl mb-2">📄</div>
      <h4 className="font-display text-text">DTF Sheet</h4>
      <p className="text-muted text-sm">Print-ready file</p>
    </button>

    <button
      onClick={handlePublish}
      className="bg-primary text-white rounded-lg p-4 hover:bg-secondary transition-colors"
    >
      <div className="text-3xl mb-2">🚀</div>
      <h4 className="font-display">Publish</h4>
      <p className="text-sm opacity-90">List for sale</p>
    </button>
  </div>

  {/* Earnings Info */}
  <div className="bg-accent/10 border border-accent/20 rounded-lg p-4 text-center">
    <p className="text-accent font-display text-lg mb-1">
      💰 Earn 10% ITC on Every Sale!
    </p>
    <p className="text-muted text-sm">
      You'll receive ITC credits when customers buy your design
    </p>
  </div>
</div>
```

---

### 3. SocialShareButtons Component
**Location**: `src/components/SocialShareButtons.tsx`

**Purpose**: Share user-generated products on social media with attribution

**Props**:
```typescript
interface SocialShareButtonsProps {
  productId: string
  productName: string
  productImage: string
  creatorUsername: string
}
```

**Implementation**:
```tsx
export const SocialShareButtons = ({ productId, productName, productImage, creatorUsername }: SocialShareButtonsProps) => {
  const shareUrl = `https://imaginethisprinted.com/products/${productId}`
  const shareText = `Check out "${productName}" created by @${creatorUsername} on ImagineThisPrinted!`

  const platforms = [
    {
      name: 'Twitter',
      icon: '🐦',
      url: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`,
      color: 'hover:bg-blue-500/20'
    },
    {
      name: 'Facebook',
      icon: '👤',
      url: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`,
      color: 'hover:bg-blue-600/20'
    },
    {
      name: 'Pinterest',
      icon: '📌',
      url: `https://pinterest.com/pin/create/button/?url=${encodeURIComponent(shareUrl)}&media=${encodeURIComponent(productImage)}&description=${encodeURIComponent(shareText)}`,
      color: 'hover:bg-red-500/20'
    }
  ]

  return (
    <div className="flex items-center gap-3">
      <span className="text-muted text-sm">Share:</span>
      {platforms.map((platform) => (
        <a
          key={platform.name}
          href={platform.url}
          target="_blank"
          rel="noopener noreferrer"
          className={`
            flex items-center gap-2 bg-card/90 border border-primary/20 rounded-lg px-4 py-2
            transition-all ${platform.color}
          `}
        >
          <span>{platform.icon}</span>
          <span className="text-text text-sm">{platform.name}</span>
        </a>
      ))}
    </div>
  )
}
```

---

## 📄 Page Structure

### UserProductCreator Page
**Location**: `src/pages/UserProductCreator.tsx`

**Route**: `/create-design` (protected, requires auth)

**Purpose**: Main page for voice-guided product creation

**Layout**:
```tsx
import { useAuth } from '@/context/SupabaseAuthContext'
import { Navigate } from 'react-router-dom'
import { VoiceProductForm } from '@/components/VoiceProductForm'

export const UserProductCreator = () => {
  const { user } = useAuth()

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return (
    <div className="min-h-screen bg-bg py-12 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="font-display text-4xl md:text-5xl text-text mb-4">
            Create Your Design
          </h1>
          <p className="text-muted text-lg">
            Use AI to bring your ideas to life. Earn 10% ITC on every sale!
          </p>
        </div>

        {/* Main Form */}
        <VoiceProductForm
          onComplete={(productId) => {
            // Redirect to product page or creator dashboard
            window.location.href = `/products/${productId}`
          }}
        />

        {/* Info Cards */}
        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-card/90 border border-primary/20 rounded-xl p-6 text-center">
            <div className="text-3xl mb-3">🎤</div>
            <h3 className="font-display text-text mb-2">Voice or Type</h3>
            <p className="text-muted text-sm">Describe your design however you prefer</p>
          </div>

          <div className="bg-card/90 border border-primary/20 rounded-xl p-6 text-center">
            <div className="text-3xl mb-3">⚡</div>
            <h3 className="font-display text-text mb-2">AI-Powered</h3>
            <p className="text-muted text-sm">Professional designs in seconds</p>
          </div>

          <div className="bg-card/90 border border-primary/20 rounded-xl p-6 text-center">
            <div className="text-3xl mb-3">💰</div>
            <h3 className="font-display text-text mb-2">Earn ITC</h3>
            <p className="text-muted text-sm">10% royalty on every sale</p>
          </div>
        </div>
      </div>
    </div>
  )
}
```

**Navigation Integration**:

Add to `src/components/Navbar.tsx`:
```tsx
// In the navigation links section
{user && (
  <Link
    to="/create-design"
    className="bg-primary text-white px-4 py-2 rounded-lg hover:bg-secondary transition-colors font-display"
  >
    Create Design
  </Link>
)}
```

---

## 🔌 API Integration

### Voice Synthesis Example
```typescript
import axios from 'axios'

const synthesizeSpeech = async (text: string) => {
  try {
    const { data } = await axios.post('/api/ai/voice/synthesize', {
      text,
      voiceId: 'female_voice_1', // Use admin settings
      speed: 1.0,
      emotion: 'neutral'
    })

    // data = { audioUrl: string, duration: number }
    return data.audioUrl
  } catch (error) {
    console.error('Speech synthesis failed:', error)
    throw error
  }
}
```

### Product Creation Flow
```typescript
const createProduct = async (formData: any) => {
  const { data } = await axios.post('/api/admin/products/ai/create', {
    prompt: formData.prompt,
    imageStyle: formData.imageStyle,
    shirtColor: formData.shirtColor,
    printStyle: formData.printStyle,
    background: 'transparent',
    mockupStyle: 'realistic',
    tone: 'professional',
    useSearch: false, // Users don't get web search
    priceTarget: 2500 // Fixed $25 pricing
  })

  return data.productId
}
```

### Status Polling
```typescript
const pollProductStatus = async (productId: string) => {
  const { data } = await axios.get(`/api/admin/products/ai/${productId}/status`)

  return {
    product: data.product,
    assets: data.assets,
    jobs: data.jobs,
    isComplete: data.jobs.every((j: any) => j.status === 'succeeded')
  }
}
```

---

## 👤 User Flows

### New User Flow
1. User clicks "Create Design" in navbar
2. If not logged in → redirect to login
3. After login → redirect back to `/create-design`
4. Welcome message plays via voice synthesis
5. User describes product (voice or text)
6. AI confirms and guides through image style
7. AI explains DTF settings for best results
8. Progress indicator during generation
9. Post-generation options presented
10. User publishes → product tagged "User Generated"

### Returning User Flow
1. User already knows the flow
2. Can skip voice guidance (toggle setting)
3. Faster navigation through steps
4. See previous creations in dashboard

---

## 🛠️ Admin Features

### Admin Voice Settings Page
**Location**: `src/pages/admin/VoiceSettings.tsx`

**Route**: `/admin/voice-settings` (admin only)

**Purpose**: Configure Minimax voice parameters

```tsx
import { useState, useEffect } from 'react'
import axios from 'axios'

export const AdminVoiceSettings = () => {
  const [settings, setSettings] = useState({
    voiceId: 'female_voice_1',
    speed: 1.0,
    emotion: 'neutral'
  })
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    const fetchSettings = async () => {
      const { data } = await axios.get('/api/ai/voice/settings')
      setSettings(data)
    }
    fetchSettings()
  }, [])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await axios.post('/api/ai/voice/settings', settings)
      alert('Voice settings saved successfully!')
    } catch (error) {
      alert('Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-8">
      <h1 className="font-display text-3xl text-text mb-8">Voice Settings</h1>

      <div className="bg-card/90 border border-primary/20 rounded-xl p-6 space-y-6">
        {/* Voice ID */}
        <div>
          <label className="block text-text font-display mb-2">Voice ID</label>
          <input
            type="text"
            value={settings.voiceId}
            onChange={(e) => setSettings({ ...settings, voiceId: e.target.value })}
            className="w-full bg-bg/50 border border-primary/20 rounded-lg p-3 text-text"
            placeholder="female_voice_1"
          />
          <p className="text-muted text-sm mt-1">
            Available voices: female_voice_1, female_voice_2, male_voice_1
          </p>
        </div>

        {/* Speed */}
        <div>
          <label className="block text-text font-display mb-2">
            Speed: {settings.speed}x
          </label>
          <input
            type="range"
            min="0.5"
            max="2.0"
            step="0.1"
            value={settings.speed}
            onChange={(e) => setSettings({ ...settings, speed: parseFloat(e.target.value) })}
            className="w-full"
          />
        </div>

        {/* Emotion */}
        <div>
          <label className="block text-text font-display mb-2">Emotion</label>
          <select
            value={settings.emotion}
            onChange={(e) => setSettings({ ...settings, emotion: e.target.value as any })}
            className="w-full bg-bg/50 border border-primary/20 rounded-lg p-3 text-text"
          >
            <option value="neutral">Neutral</option>
            <option value="happy">Happy</option>
            <option value="sad">Sad</option>
            <option value="angry">Angry</option>
            <option value="fearful">Fearful</option>
          </select>
        </div>

        {/* Save Button */}
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="w-full bg-primary text-white font-display py-3 rounded-lg hover:bg-secondary transition-colors disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  )
}
```

---

## ✅ Technical Requirements

### Browser Compatibility
- **Web Speech API** (Chrome, Edge, Safari - check for `webkitSpeechRecognition`)
- Fallback to text-only mode if speech API unavailable

### Performance
- Lazy load audio files
- Cancel voice synthesis if user navigates away
- Debounce voice input to avoid rapid API calls

### Accessibility
- All buttons must have `aria-label` attributes
- Voice input should have visual feedback
- Keyboard navigation support (Tab, Enter, Space)

### Error Handling
```typescript
// Handle voice synthesis errors
try {
  const audioUrl = await synthesizeSpeech(text)
  audioRef.current.src = audioUrl
  audioRef.current.play()
} catch (error) {
  // Fallback: show text without audio
  setError('Voice synthesis unavailable. Continuing with text...')
}

// Handle voice recognition errors
recognition.onerror = (event) => {
  if (event.error === 'no-speech') {
    setError('No speech detected. Please try again.')
  } else if (event.error === 'audio-capture') {
    setError('Microphone not found. Please enable microphone access.')
  } else {
    setError(`Voice recognition error: ${event.error}`)
  }
}
```

---

## 🧪 Testing Checklist

### Voice Functionality
- [ ] Voice synthesis plays correctly
- [ ] Voice recognition captures speech accurately
- [ ] AI messages are contextually appropriate
- [ ] Audio stops when user navigates away
- [ ] Error handling works for missing microphone

### Form Flow
- [ ] All 5 steps work sequentially
- [ ] Step navigation is smooth
- [ ] Form data persists across steps
- [ ] Progress indicator updates correctly
- [ ] Post-generation options are functional

### API Integration
- [ ] Product creation succeeds
- [ ] Status polling works
- [ ] Background removal job creates
- [ ] Mockup generation uses correct shirt color
- [ ] Admin settings save and load

### UI/UX
- [ ] Theme colors work in light/dark mode
- [ ] Glass effects render correctly
- [ ] Glow animations are smooth
- [ ] Mobile responsive (test on 375px width)
- [ ] Buttons have hover states

### User Attribution
- [ ] Products tagged "User Generated"
- [ ] Creator username displays on product page
- [ ] Social share buttons include attribution
- [ ] Royalty tracking works (10% ITC)

---

## 📝 Additional Notes

### Fixed Pricing
All user-generated products are **$25 each** or **3 for $25** (bundle deal). Do not allow users to set custom pricing.

### Authentication
The `/create-design` route MUST check for authentication:
```tsx
const { user } = useAuth()
if (!user) return <Navigate to="/login" replace />
```

### Database Schema (Reference)
You don't need to modify the database. The backend already handles:
- `products` table with `metadata.ai_generated = true`
- `metadata.created_by_user_id` for attribution
- `user_wallets` for ITC royalty tracking

### Supabase Admin Settings Table
Backend service will use this table (not yet created):
```sql
CREATE TABLE admin_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO admin_settings (key, value) VALUES
('voice', '{"voiceId": "female_voice_1", "speed": 1.0, "emotion": "neutral"}');
```

---

## 🚀 Deployment Checklist

Before deploying:
1. Test voice synthesis on production API
2. Verify CORS allows frontend domain
3. Test with real Replicate API (not mock data)
4. Ensure Railway environment variables are set:
   - `REPLICATE_API_TOKEN`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
5. Test authentication flow end-to-end
6. Verify product creation creates proper database entries

---

## 💬 Questions?

If you encounter issues:
1. Check browser console for errors
2. Verify API endpoints return expected data
3. Test authentication state with `/api/auth/me`
4. Check Network tab for failed requests

**Backend API is fully functional**. Focus on UI/UX implementation and connecting to existing endpoints.

Good luck! 🎉
