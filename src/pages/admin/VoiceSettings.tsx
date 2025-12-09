import { useState, useEffect } from 'react'
import axios from 'axios'

export const AdminVoiceSettings = () => {
    const [settings, setSettings] = useState({
        voiceId: 'socialmedia_female_2_v1',
        speed: 1.0,
        emotion: 'neutral'
    })
    const [isSaving, setIsSaving] = useState(false)

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const { data } = await axios.get('/api/ai/voice/settings')
                setSettings(data)
            } catch (error) {
                console.error('Failed to fetch settings', error)
            }
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
                        Available voices: socialmedia_female_2_v1, female_voice_1, male_voice_1
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
                        style={{ color: 'black' }} // Ensure text is visible if bg is light
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
