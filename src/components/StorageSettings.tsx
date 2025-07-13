import React, { useState, useEffect } from 'react'
import { uploadFile, getStorageConfig, type FileType } from '../utils/storage'

interface StorageSettings {
  defaultProvider: 'supabase' | 's3'
  fileTypeOverrides: Record<FileType, 'supabase' | 's3' | 'auto'>
  autoUpgradeToS3: boolean
  maxSupabaseFileSize: number // in MB
}

const StorageSettingsComponent: React.FC = () => {
  const [settings, setSettings] = useState<StorageSettings>({
    defaultProvider: 'supabase',
    fileTypeOverrides: {
      '3d-files': 'auto',
      'dashboards': 'auto',
      'previews': 'auto',
      'product-photos': 's3',
      'ai-art': 's3',
      'videos': 's3',
      'social-content': 's3'
    },
    autoUpgradeToS3: true,
    maxSupabaseFileSize: 50
  })

  const [testFile, setTestFile] = useState<File | null>(null)
  const [testResult, setTestResult] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)

  const fileTypes: FileType[] = [
    '3d-files',
    'dashboards', 
    'previews',
    'product-photos',
    'ai-art',
    'videos',
    'social-content'
  ]

  const saveSettings = () => {
    localStorage.setItem('storageSettings', JSON.stringify(settings))
    alert('Storage settings saved!')
  }

  const loadSettings = () => {
    const saved = localStorage.getItem('storageSettings')
    if (saved) {
      setSettings(JSON.parse(saved))
    }
  }

  useEffect(() => {
    loadSettings()
  }, [])

  const handleFileTypeOverrideChange = (fileType: FileType, provider: 'supabase' | 's3' | 'auto') => {
    setSettings(prev => ({
      ...prev,
      fileTypeOverrides: {
        ...prev.fileTypeOverrides,
        [fileType]: provider
      }
    }))
  }

  const testUpload = async () => {
    if (!testFile) return

    setIsLoading(true)
    setTestResult('')

    try {
      const result = await uploadFile(testFile, '3d-files', {
        forceProvider: settings.defaultProvider
      })

      if (result.error) {
        setTestResult(`❌ Error: ${result.error}`)
      } else {
        setTestResult(`✅ Success! 
Provider: ${result.provider}
URL: ${result.url}
Path: ${result.path}`)
      }
    } catch (error) {
      setTestResult(`❌ Error: ${String(error)}`)
    } finally {
      setIsLoading(false)
    }
  }

  const getStorageRecommendation = (fileType: FileType) => {
    const config = getStorageConfig(fileType)
    return config.provider === 's3' ? 'Recommended: S3 (production-grade)' : 'Recommended: Supabase (basic)'
  }

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h3 className="text-xl font-bold mb-6">Storage Configuration</h3>
      
      {/* Default Provider */}
      <div className="mb-6">
        <label className="block text-sm font-medium mb-2">Default Storage Provider</label>
        <select
          value={settings.defaultProvider}
          onChange={(e) => setSettings(prev => ({ ...prev, defaultProvider: e.target.value as 'supabase' | 's3' }))}
          className="border rounded px-3 py-2 w-full"
        >
          <option value="supabase">Supabase (Basic uploads, previews)</option>
          <option value="s3">AWS S3 (Production-grade media)</option>
        </select>
      </div>

      {/* File Type Overrides */}
      <div className="mb-6">
        <h4 className="text-lg font-semibold mb-3">File Type Specific Settings</h4>
        <div className="space-y-3">
          {fileTypes.map(fileType => (
            <div key={fileType} className="flex items-center justify-between p-3 border rounded">
              <div>
                <span className="font-medium capitalize">{fileType.replace('-', ' ')}</span>
                <p className="text-xs text-gray-500">{getStorageRecommendation(fileType)}</p>
              </div>
              <select
                value={settings.fileTypeOverrides[fileType]}
                onChange={(e) => handleFileTypeOverrideChange(fileType, e.target.value as any)}
                className="border rounded px-2 py-1 text-sm"
              >
                <option value="auto">Auto (follow recommendation)</option>
                <option value="supabase">Force Supabase</option>
                <option value="s3">Force S3</option>
              </select>
            </div>
          ))}
        </div>
      </div>

      {/* Advanced Settings */}
      <div className="mb-6">
        <h4 className="text-lg font-semibold mb-3">Advanced Settings</h4>
        
        <div className="space-y-3">
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={settings.autoUpgradeToS3}
              onChange={(e) => setSettings(prev => ({ ...prev, autoUpgradeToS3: e.target.checked }))}
              className="mr-2"
            />
            <span>Auto-upgrade large files to S3</span>
          </label>

          <div>
            <label className="block text-sm font-medium mb-1">
              Max Supabase file size (MB)
            </label>
            <input
              type="number"
              value={settings.maxSupabaseFileSize}
              onChange={(e) => setSettings(prev => ({ ...prev, maxSupabaseFileSize: parseInt(e.target.value) }))}
              className="border rounded px-3 py-2 w-32"
              min="1"
              max="100"
            />
          </div>
        </div>
      </div>

      {/* Test Upload */}
      <div className="mb-6 border-t pt-4">
        <h4 className="text-lg font-semibold mb-3">Test Upload</h4>
        <div className="space-y-3">
          <input
            type="file"
            onChange={(e) => setTestFile(e.target.files?.[0] || null)}
            className="border rounded px-3 py-2 w-full"
          />
          <button
            onClick={testUpload}
            disabled={!testFile || isLoading}
            className="bg-blue-500 text-white px-4 py-2 rounded disabled:bg-gray-300"
          >
            {isLoading ? 'Testing...' : 'Test Upload'}
          </button>
          {testResult && (
            <pre className="bg-gray-100 p-3 rounded text-sm whitespace-pre-wrap">
              {testResult}
            </pre>
          )}
        </div>
      </div>

      {/* Save Button */}
      <button
        onClick={saveSettings}
        className="bg-green-500 text-white px-6 py-2 rounded hover:bg-green-600"
      >
        Save Settings
      </button>

      {/* Environment Status */}
      <div className="mt-6 p-4 bg-gray-50 rounded">
        <h5 className="font-semibold mb-2">Environment Status</h5>
        <div className="text-sm space-y-1">
          <div>Supabase: {import.meta.env.VITE_SUPABASE_URL ? '✅ Configured' : '❌ Not configured'}</div>
          <div>AWS S3: {import.meta.env.AWS_ACCESS_KEY_ID ? '✅ Configured' : '❌ Not configured'}</div>
          <div>CloudFront CDN: {import.meta.env.CLOUDFRONT_URL ? '✅ Configured' : '⚠️ Not configured (optional)'}</div>
        </div>
      </div>
    </div>
  )
}

export default StorageSettingsComponent