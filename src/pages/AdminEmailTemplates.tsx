import React, { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
import { apiFetch } from '../lib/api'
import {
  Mail,
  Sparkles,
  Eye,
  Send,
  Save,
  Settings,
  ChevronDown,
  ChevronUp,
  Check,
  X,
  RefreshCw,
  BarChart3,
  Clock,
  Wand2
} from 'lucide-react'

interface EmailTemplate {
  id: string
  template_key: string
  name: string
  description: string
  subject_template: string
  html_template: string
  ai_enabled: boolean
  ai_prompt_context: string
  ai_tone: string
  mr_imagine_enabled: boolean
  mr_imagine_greeting: string
  category: string
  is_active: boolean
  version: number
  created_at: string
  updated_at: string
}

interface EmailLog {
  id: string
  template_key: string
  recipient_email: string
  subject_sent: string
  ai_personalization_used: boolean
  status: string
  sent_at: string
}

interface EmailStats {
  totalSent: number
  aiGenerated: number
  byTemplate: Record<string, number>
}

const AdminEmailTemplates: React.FC = () => {
  const { user } = useAuth()
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [logs, setLogs] = useState<EmailLog[]>([])
  const [stats, setStats] = useState<EmailStats | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [selectedTemplate, setSelectedTemplate] = useState<EmailTemplate | null>(null)
  const [expandedTemplate, setExpandedTemplate] = useState<string | null>(null)
  const [previewHtml, setPreviewHtml] = useState<string>('')
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<'templates' | 'logs' | 'stats'>('templates')
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Load templates
  const loadTemplates = useCallback(async () => {
    try {
      const result = await apiFetch('/api/admin/email-templates')
      if (result?.templates) {
        setTemplates(result.templates)
      }
    } catch (err) {
      console.error('[EmailTemplates] Error loading templates:', err)
      setMessage({ type: 'error', text: 'Failed to load templates' })
    }
  }, [])

  // Load logs
  const loadLogs = useCallback(async () => {
    try {
      const result = await apiFetch('/api/admin/email-templates/logs/recent?limit=50')
      if (result?.logs) {
        setLogs(result.logs)
      }
    } catch (err) {
      console.error('[EmailTemplates] Error loading logs:', err)
    }
  }, [])

  // Load stats
  const loadStats = useCallback(async () => {
    try {
      const result = await apiFetch('/api/admin/email-templates/stats/overview')
      if (result?.stats) {
        setStats(result.stats)
      }
    } catch (err) {
      console.error('[EmailTemplates] Error loading stats:', err)
    }
  }, [])

  useEffect(() => {
    if (user && (user.role === 'admin' || user.role === 'manager')) {
      setIsLoading(true)
      Promise.all([loadTemplates(), loadLogs(), loadStats()])
        .finally(() => setIsLoading(false))
    }
  }, [user, loadTemplates, loadLogs, loadStats])

  // Generate preview
  const generatePreview = async (templateKey: string) => {
    setIsPreviewLoading(true)
    try {
      const result = await apiFetch(`/api/admin/email-templates/${templateKey}/preview`, {
        method: 'POST',
        body: JSON.stringify({
          sampleData: {
            customerName: 'John Doe',
            orderNumber: 'ITP-PREVIEW-123',
            items: [
              { name: 'Custom Vintage Tee - Medium', quantity: 1, price: 29.99 },
              { name: 'Design Hoodie - Large', quantity: 1, price: 49.99 }
            ],
            total: 79.98
          }
        })
      })
      if (result?.htmlContent) {
        setPreviewHtml(result.htmlContent)
      }
    } catch (err) {
      console.error('[EmailTemplates] Error generating preview:', err)
      setMessage({ type: 'error', text: 'Failed to generate preview' })
    } finally {
      setIsPreviewLoading(false)
    }
  }

  // Send test email
  const sendTestEmail = async (templateKey: string) => {
    if (!testEmail) {
      setMessage({ type: 'error', text: 'Please enter an email address' })
      return
    }

    setIsSending(true)
    try {
      await apiFetch(`/api/admin/email-templates/${templateKey}/send-test`, {
        method: 'POST',
        body: JSON.stringify({ testEmail })
      })
      setMessage({ type: 'success', text: `Test email sent to ${testEmail}` })
    } catch (err: any) {
      console.error('[EmailTemplates] Error sending test:', err)
      setMessage({ type: 'error', text: err.message || 'Failed to send test email' })
    } finally {
      setIsSending(false)
    }
  }

  // Save template
  const saveTemplate = async (template: EmailTemplate) => {
    setIsSaving(true)
    try {
      await apiFetch(`/api/admin/email-templates/${template.template_key}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ai_enabled: template.ai_enabled,
          ai_prompt_context: template.ai_prompt_context,
          ai_tone: template.ai_tone,
          mr_imagine_enabled: template.mr_imagine_enabled,
          mr_imagine_greeting: template.mr_imagine_greeting,
          is_active: template.is_active
        })
      })
      setMessage({ type: 'success', text: 'Template saved successfully' })
      loadTemplates()
    } catch (err: any) {
      console.error('[EmailTemplates] Error saving:', err)
      setMessage({ type: 'error', text: err.message || 'Failed to save template' })
    } finally {
      setIsSaving(false)
    }
  }

  // Update local template state
  const updateTemplate = (key: string, field: keyof EmailTemplate, value: any) => {
    setTemplates(prev => prev.map(t =>
      t.template_key === key ? { ...t, [field]: value } : t
    ))
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted">Loading email templates...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg">
      {/* Header */}
      <section className="relative py-10 sm:py-14 bg-gradient-to-br from-purple-50 via-bg to-pink-50 overflow-hidden">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-24 -right-24 w-96 h-96 bg-purple-200/30 rounded-full blur-3xl" />
          <div className="absolute -bottom-24 -left-24 w-80 h-80 bg-pink-200/30 rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-purple-100 text-purple-700 text-sm font-medium mb-3">
                <Mail className="w-4 h-4" />
                Email Management
              </span>
              <h1 className="font-display text-3xl sm:text-4xl text-text">
                Email <span className="text-gradient">Templates</span>
              </h1>
              <p className="text-muted mt-2">
                Manage AI-powered email templates with Mr. Imagine personality
              </p>
            </div>

            {stats && (
              <div className="flex gap-4">
                <div className="card-editorial p-4 text-center">
                  <p className="text-2xl font-bold text-purple-600">{stats.totalSent}</p>
                  <p className="text-xs text-muted">Emails Sent</p>
                </div>
                <div className="card-editorial p-4 text-center">
                  <p className="text-2xl font-bold text-emerald-600">{stats.aiGenerated}</p>
                  <p className="text-xs text-muted">AI Personalized</p>
                </div>
              </div>
            )}
          </div>

          {/* Tabs */}
          <div className="flex gap-2 mt-6">
            {(['templates', 'logs', 'stats'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
                  activeTab === tab
                    ? 'bg-purple-600 text-white'
                    : 'bg-white text-muted hover:text-text'
                }`}
              >
                {tab === 'templates' && <Settings className="w-4 h-4 inline mr-2" />}
                {tab === 'logs' && <Clock className="w-4 h-4 inline mr-2" />}
                {tab === 'stats' && <BarChart3 className="w-4 h-4 inline mr-2" />}
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Message Toast */}
      {message && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg ${
          message.type === 'success' ? 'bg-emerald-500' : 'bg-red-500'
        } text-white flex items-center gap-2`}>
          {message.type === 'success' ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
          {message.text}
          <button onClick={() => setMessage(null)} className="ml-2">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'templates' && (
          <div className="space-y-4">
            {templates.map(template => (
              <div key={template.id} className="card-editorial overflow-hidden">
                {/* Template Header */}
                <div
                  className="p-5 cursor-pointer hover:bg-purple-50/50 transition-colors"
                  onClick={() => setExpandedTemplate(
                    expandedTemplate === template.template_key ? null : template.template_key
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                        template.ai_enabled ? 'bg-purple-100' : 'bg-gray-100'
                      }`}>
                        {template.ai_enabled ? (
                          <Sparkles className="w-6 h-6 text-purple-600" />
                        ) : (
                          <Mail className="w-6 h-6 text-gray-500" />
                        )}
                      </div>
                      <div>
                        <h3 className="font-semibold text-text">{template.name}</h3>
                        <p className="text-sm text-muted">{template.description}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                        template.is_active
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}>
                        {template.is_active ? 'Active' : 'Inactive'}
                      </span>
                      <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                        {template.category}
                      </span>
                      {expandedTemplate === template.template_key ? (
                        <ChevronUp className="w-5 h-5 text-muted" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-muted" />
                      )}
                    </div>
                  </div>
                </div>

                {/* Expanded Content */}
                {expandedTemplate === template.template_key && (
                  <div className="border-t border-gray-100 p-5 space-y-6">
                    {/* Settings */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* AI Settings */}
                      <div className="space-y-4">
                        <h4 className="font-medium text-text flex items-center gap-2">
                          <Wand2 className="w-4 h-4 text-purple-600" />
                          AI Personalization
                        </h4>

                        <label className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={template.ai_enabled}
                            onChange={(e) => updateTemplate(template.template_key, 'ai_enabled', e.target.checked)}
                            className="w-5 h-5 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                          />
                          <span className="text-sm text-text">Enable AI-generated content</span>
                        </label>

                        <div>
                          <label className="block text-sm font-medium text-muted mb-1">AI Tone</label>
                          <select
                            value={template.ai_tone}
                            onChange={(e) => updateTemplate(template.template_key, 'ai_tone', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                          >
                            <option value="friendly_humorous">Friendly & Humorous</option>
                            <option value="professional">Professional</option>
                            <option value="casual">Casual</option>
                            <option value="enthusiastic">Enthusiastic</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-muted mb-1">AI Context Prompt</label>
                          <textarea
                            value={template.ai_prompt_context}
                            onChange={(e) => updateTemplate(template.template_key, 'ai_prompt_context', e.target.value)}
                            rows={4}
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm"
                            placeholder="Instructions for AI when generating this email..."
                          />
                        </div>
                      </div>

                      {/* Mr. Imagine Settings */}
                      <div className="space-y-4">
                        <h4 className="font-medium text-text flex items-center gap-2">
                          <span className="text-xl">🎨</span>
                          Mr. Imagine Branding
                        </h4>

                        <label className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={template.mr_imagine_enabled}
                            onChange={(e) => updateTemplate(template.template_key, 'mr_imagine_enabled', e.target.checked)}
                            className="w-5 h-5 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                          />
                          <span className="text-sm text-text">Show Mr. Imagine header</span>
                        </label>

                        <div>
                          <label className="block text-sm font-medium text-muted mb-1">Mr. Imagine Greeting</label>
                          <input
                            type="text"
                            value={template.mr_imagine_greeting}
                            onChange={(e) => updateTemplate(template.template_key, 'mr_imagine_greeting', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                            placeholder="Hey there, creative soul!"
                          />
                        </div>

                        <label className="flex items-center gap-3 mt-4">
                          <input
                            type="checkbox"
                            checked={template.is_active}
                            onChange={(e) => updateTemplate(template.template_key, 'is_active', e.target.checked)}
                            className="w-5 h-5 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                          />
                          <span className="text-sm text-text">Template is active</span>
                        </label>
                      </div>
                    </div>

                    {/* Preview & Test */}
                    <div className="border-t border-gray-100 pt-6">
                      <h4 className="font-medium text-text mb-4">Preview & Test</h4>

                      <div className="flex flex-wrap gap-3 mb-4">
                        <button
                          onClick={() => generatePreview(template.template_key)}
                          disabled={isPreviewLoading}
                          className="btn-primary flex items-center gap-2"
                        >
                          {isPreviewLoading ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                          Generate Preview
                        </button>

                        <div className="flex gap-2">
                          <input
                            type="email"
                            value={testEmail}
                            onChange={(e) => setTestEmail(e.target.value)}
                            placeholder="your@email.com"
                            className="px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm w-48"
                          />
                          <button
                            onClick={() => sendTestEmail(template.template_key)}
                            disabled={isSending || !testEmail}
                            className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors flex items-center gap-2 disabled:opacity-50"
                          >
                            {isSending ? (
                              <RefreshCw className="w-4 h-4 animate-spin" />
                            ) : (
                              <Send className="w-4 h-4" />
                            )}
                            Send Test
                          </button>
                        </div>
                      </div>

                      {/* Preview iframe */}
                      {previewHtml && (
                        <div className="border border-gray-200 rounded-lg overflow-hidden bg-gray-100">
                          <div className="bg-gray-200 px-3 py-2 text-xs text-gray-600 flex items-center gap-2">
                            <div className="flex gap-1.5">
                              <span className="w-3 h-3 rounded-full bg-red-400" />
                              <span className="w-3 h-3 rounded-full bg-yellow-400" />
                              <span className="w-3 h-3 rounded-full bg-green-400" />
                            </div>
                            Email Preview
                          </div>
                          <iframe
                            srcDoc={previewHtml}
                            className="w-full h-[600px] bg-white"
                            title="Email Preview"
                          />
                        </div>
                      )}
                    </div>

                    {/* Save Button */}
                    <div className="flex justify-end pt-4 border-t border-gray-100">
                      <button
                        onClick={() => saveTemplate(template)}
                        disabled={isSaving}
                        className="btn-primary flex items-center gap-2"
                      >
                        {isSaving ? (
                          <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : (
                          <Save className="w-4 h-4" />
                        )}
                        Save Changes
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {activeTab === 'logs' && (
          <div className="card-editorial overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-text">Recent Email Logs</h3>
              <button
                onClick={loadLogs}
                className="text-purple-600 hover:text-purple-700 flex items-center gap-1 text-sm"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh
              </button>
            </div>

            <div className="divide-y divide-gray-100">
              {logs.length === 0 ? (
                <div className="p-8 text-center text-muted">
                  No email logs found. Emails will appear here after they're sent.
                </div>
              ) : (
                logs.map(log => (
                  <div key={log.id} className="p-4 hover:bg-purple-50/30 transition-colors">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          log.ai_personalization_used
                            ? 'bg-purple-100 text-purple-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}>
                          {log.ai_personalization_used ? 'AI Generated' : 'Static'}
                        </span>
                        <span className="text-sm font-medium text-text">{log.template_key}</span>
                      </div>
                      <span className="text-xs text-muted">
                        {new Date(log.sent_at).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm text-muted">{log.recipient_email}</p>
                    <p className="text-sm text-text truncate">{log.subject_sent}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === 'stats' && stats && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="card-editorial p-6">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
                  <Mail className="w-6 h-6 text-purple-600" />
                </div>
                <div>
                  <p className="text-3xl font-bold text-text">{stats.totalSent}</p>
                  <p className="text-sm text-muted">Total Emails Sent</p>
                </div>
              </div>
            </div>

            <div className="card-editorial p-6">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
                  <Sparkles className="w-6 h-6 text-emerald-600" />
                </div>
                <div>
                  <p className="text-3xl font-bold text-text">{stats.aiGenerated}</p>
                  <p className="text-sm text-muted">AI Personalized</p>
                </div>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-emerald-500 h-2 rounded-full"
                  style={{ width: `${stats.totalSent > 0 ? (stats.aiGenerated / stats.totalSent) * 100 : 0}%` }}
                />
              </div>
              <p className="text-xs text-muted mt-2">
                {stats.totalSent > 0 ? Math.round((stats.aiGenerated / stats.totalSent) * 100) : 0}% of emails
              </p>
            </div>

            <div className="card-editorial p-6">
              <h3 className="font-semibold text-text mb-4">By Template</h3>
              <div className="space-y-3">
                {Object.entries(stats.byTemplate).map(([key, count]) => (
                  <div key={key} className="flex items-center justify-between">
                    <span className="text-sm text-muted">{key.replace(/_/g, ' ')}</span>
                    <span className="font-medium text-text">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default AdminEmailTemplates
