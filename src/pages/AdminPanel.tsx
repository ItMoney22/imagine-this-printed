import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
// Removed direct Prisma import - using API endpoints instead

interface DbTable {
  name: string
  count: number
  columns: string[]
}

interface TableData {
  [key: string]: any
}

interface PrismaStats {
  lastSync: string
  status: 'connected' | 'disconnected' | 'syncing'
  error?: string
}

const AdminPanel: React.FC = () => {
  const { user } = useAuth()
  const [selectedTab, setSelectedTab] = useState<'overview' | 'tables' | 'users' | 'prisma' | 'tools'>('overview')
  const [tables, setTables] = useState<DbTable[]>([])
  const [selectedTable, setSelectedTable] = useState<string>('')
  const [tableData, setTableData] = useState<TableData[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [prismaStats, setPrismaStats] = useState<PrismaStats>({
    lastSync: new Date().toISOString(),
    status: 'connected'
  })
  const [newUserForm, setNewUserForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'customer'
  })

  useEffect(() => {
    if (user?.role === 'admin') {
      loadTables()
    }
  }, [user])

  const loadTables = async () => {
    try {
      setIsLoading(true)
      
      const token = localStorage.getItem('auth_token')
      if (!token) {
        setPrismaStats(prev => ({ ...prev, status: 'disconnected', error: 'Authentication required' }))
        return
      }

      const response = await fetch('/api/admin/tables', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to load tables')
      }

      const data = await response.json()
      setTables(data.tables)
    } catch (error) {
      console.error('Error loading tables:', error)
      setPrismaStats(prev => ({ ...prev, status: 'disconnected', error: String(error) }))
    } finally {
      setIsLoading(false)
    }
  }

  const loadTableData = async (tableName: string) => {
    try {
      setIsLoading(true)
      setSelectedTable(tableName)
      
      const token = localStorage.getItem('auth_token')
      if (!token) {
        setTableData([])
        return
      }

      const response = await fetch(`/api/admin/table-data?tableName=${tableName}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to load table data')
      }

      const result = await response.json()
      setTableData(result.data || [])
      
      // Update table columns
      setTables(prev => prev.map(table => 
        table.name === tableName ? { ...table, columns: result.columns } : table
      ))
    } catch (error) {
      console.error('Error loading table data:', error)
      setTableData([])
    } finally {
      setIsLoading(false)
    }
  }

  const runPrismaDbPush = async () => {
    try {
      setPrismaStats(prev => ({ ...prev, status: 'syncing' }))
      
      // In a real implementation, this would trigger the actual prisma db push
      // For now, we'll simulate it
      await new Promise(resolve => setTimeout(resolve, 2000))
      
      setPrismaStats({
        lastSync: new Date().toISOString(),
        status: 'connected'
      })
      
      // Reload tables after sync
      await loadTables()
    } catch (error) {
      setPrismaStats(prev => ({ 
        ...prev, 
        status: 'disconnected', 
        error: String(error) 
      }))
    }
  }

  const runPrismaMigrateDev = async () => {
    try {
      setPrismaStats(prev => ({ ...prev, status: 'syncing' }))
      
      // In a real implementation, this would trigger the actual prisma migrate dev
      await new Promise(resolve => setTimeout(resolve, 3000))
      
      setPrismaStats({
        lastSync: new Date().toISOString(),
        status: 'connected'
      })
      
      await loadTables()
    } catch (error) {
      setPrismaStats(prev => ({ 
        ...prev, 
        status: 'disconnected', 
        error: String(error) 
      }))
    }
  }

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const token = localStorage.getItem('auth_token')
      if (!token) {
        alert('Authentication required')
        return
      }

      const response = await fetch('/api/admin/create-user', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newUserForm)
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to create user')
      }

      const result = await response.json()
      setNewUserForm({ name: '', email: '', password: '', role: 'customer' })
      alert(result.message)
      
      // Reload tables to reflect new user
      await loadTables()
    } catch (error) {
      console.error('Error creating user:', error)
      alert('Failed to create user: ' + String(error))
    }
  }

  const formatValue = (value: any) => {
    if (value === null || value === undefined) return 'NULL'
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
    if (typeof value === 'object') return JSON.stringify(value)
    if (typeof value === 'string' && value.length > 50) {
      return value.substring(0, 50) + '...'
    }
    return String(value)
  }

  if (user?.role !== 'admin') {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <p className="text-red-800">Access denied. Admin access required.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Admin Panel</h1>
        <p className="text-gray-600">Database Control Center - Direct access to all tables and operations</p>
      </div>

      {/* Status Bar */}
      <div className="mb-6 bg-white rounded-lg shadow p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="flex items-center">
              <div className={`w-3 h-3 rounded-full mr-2 ${
                prismaStats.status === 'connected' ? 'bg-green-500' : 
                prismaStats.status === 'syncing' ? 'bg-yellow-500' : 'bg-red-500'
              }`}></div>
              <span className="text-sm font-medium text-gray-700">
                Database: {prismaStats.status}
              </span>
            </div>
            <div className="text-sm text-gray-500">
              Last sync: {new Date(prismaStats.lastSync).toLocaleString()}
            </div>
          </div>
          <div className="text-sm text-gray-500">
            Logged in as: {user?.email} (Admin)
          </div>
        </div>
        {prismaStats.error && (
          <div className="mt-2 text-sm text-red-600">
            Error: {prismaStats.error}
          </div>
        )}
      </div>

      {/* Navigation Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8">
          {[
            { id: 'overview', label: 'Overview', icon: '🏠' },
            { id: 'tables', label: 'Tables', icon: '📊' },
            { id: 'users', label: 'Users', icon: '👥' },
            { id: 'prisma', label: 'Prisma Tools', icon: '🔧' },
            { id: 'tools', label: 'Tools', icon: '⚙️' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSelectedTab(tab.id as any)}
              className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center ${
                selectedTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <span className="mr-2">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Overview Tab */}
      {selectedTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Total Tables</h3>
              <p className="text-3xl font-bold text-blue-600">{tables.length}</p>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Total Users</h3>
              <p className="text-3xl font-bold text-green-600">
                {tables.find(t => t.name === 'user_profiles')?.count || 0}
              </p>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Total Orders</h3>
              <p className="text-3xl font-bold text-purple-600">
                {tables.find(t => t.name === 'orders')?.count || 0}
              </p>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Total Products</h3>
              <p className="text-3xl font-bold text-orange-600">
                {tables.find(t => t.name === 'products')?.count || 0}
              </p>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">Table Overview</h3>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {tables.map((table) => (
                  <div key={table.name} className="border rounded-lg p-4 hover:bg-gray-50">
                    <div className="flex justify-between items-center">
                      <h4 className="font-medium text-gray-900">{table.name}</h4>
                      <span className="text-sm text-gray-500">{table.count} rows</span>
                    </div>
                    <button
                      onClick={() => loadTableData(table.name)}
                      className="mt-2 text-sm text-blue-600 hover:text-blue-800"
                    >
                      View Data →
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tables Tab */}
      {selectedTab === 'tables' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">Database Tables</h3>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                {tables.map((table) => (
                  <button
                    key={table.name}
                    onClick={() => loadTableData(table.name)}
                    className={`text-left border rounded-lg p-4 hover:bg-gray-50 ${
                      selectedTable === table.name ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <h4 className="font-medium text-gray-900">{table.name}</h4>
                      <span className="text-sm text-gray-500">{table.count} rows</span>
                    </div>
                  </button>
                ))}
              </div>

              {selectedTable && (
                <div className="border rounded-lg overflow-hidden">
                  <div className="bg-gray-50 px-4 py-2 border-b">
                    <h4 className="font-medium text-gray-900">
                      {selectedTable} ({tableData.length} rows)
                    </h4>
                  </div>
                  <div className="overflow-x-auto">
                    {isLoading ? (
                      <div className="p-8 text-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                        <p className="mt-2 text-gray-500">Loading...</p>
                      </div>
                    ) : tableData.length > 0 ? (
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            {Object.keys(tableData[0]).map((column) => (
                              <th
                                key={column}
                                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                              >
                                {column}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {tableData.map((row, index) => (
                            <tr key={index} className="hover:bg-gray-50">
                              {Object.values(row).map((value, cellIndex) => (
                                <td
                                  key={cellIndex}
                                  className="px-6 py-4 whitespace-nowrap text-sm text-gray-900"
                                >
                                  {formatValue(value)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div className="p-8 text-center text-gray-500">
                        No data found
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Users Tab */}
      {selectedTab === 'users' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">Add New User</h3>
            </div>
            <div className="p-6">
              <form onSubmit={createUser} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Full Name
                    </label>
                    <input
                      type="text"
                      value={newUserForm.name}
                      onChange={(e) => setNewUserForm(prev => ({ ...prev, name: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Email
                    </label>
                    <input
                      type="email"
                      value={newUserForm.email}
                      onChange={(e) => setNewUserForm(prev => ({ ...prev, email: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Password
                    </label>
                    <input
                      type="password"
                      value={newUserForm.password}
                      onChange={(e) => setNewUserForm(prev => ({ ...prev, password: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Role
                    </label>
                    <select
                      value={newUserForm.role}
                      onChange={(e) => setNewUserForm(prev => ({ ...prev, role: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="customer">Customer</option>
                      <option value="vendor">Vendor</option>
                      <option value="manager">Manager</option>
                      <option value="founder">Founder</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                </div>
                <button
                  type="submit"
                  className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  Create User
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Prisma Tools Tab */}
      {selectedTab === 'prisma' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">Prisma Operations</h3>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div>
                  <h4 className="font-medium text-gray-900">Database Push</h4>
                  <p className="text-sm text-gray-500">Push the Prisma schema to the database</p>
                </div>
                <button
                  onClick={runPrismaDbPush}
                  disabled={prismaStats.status === 'syncing'}
                  className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {prismaStats.status === 'syncing' ? 'Syncing...' : 'Run db push'}
                </button>
              </div>
              
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div>
                  <h4 className="font-medium text-gray-900">Migration Dev</h4>
                  <p className="text-sm text-gray-500">Create and apply database migrations</p>
                </div>
                <button
                  onClick={runPrismaMigrateDev}
                  disabled={prismaStats.status === 'syncing'}
                  className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {prismaStats.status === 'syncing' ? 'Syncing...' : 'Run migrate dev'}
                </button>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">Prisma Schema Viewer</h3>
            </div>
            <div className="p-6">
              <div className="bg-gray-900 text-green-400 p-4 rounded-lg font-mono text-sm overflow-x-auto">
                <pre>
{`// Prisma Schema Overview
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// Main Models:
// - UserProfile (${tables.find(t => t.name === 'user_profiles')?.count || 0} records)
// - Product (${tables.find(t => t.name === 'products')?.count || 0} records)
// - Order (${tables.find(t => t.name === 'orders')?.count || 0} records)
// - UserWallet (${tables.find(t => t.name === 'user_wallets')?.count || 0} records)
// - And ${tables.length - 4} more tables...`}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tools Tab */}
      {selectedTab === 'tools' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">Database Tools</h3>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="border rounded-lg p-4">
                  <h4 className="font-medium text-gray-900 mb-2">Database Backup</h4>
                  <p className="text-sm text-gray-500 mb-4">
                    Create a backup of the current database
                  </p>
                  <button className="bg-purple-600 text-white px-4 py-2 rounded-md hover:bg-purple-700">
                    Create Backup
                  </button>
                </div>
                
                <div className="border rounded-lg p-4">
                  <h4 className="font-medium text-gray-900 mb-2">Clear Cache</h4>
                  <p className="text-sm text-gray-500 mb-4">
                    Clear application cache and refresh data
                  </p>
                  <button className="bg-orange-600 text-white px-4 py-2 rounded-md hover:bg-orange-700">
                    Clear Cache
                  </button>
                </div>
                
                <div className="border rounded-lg p-4">
                  <h4 className="font-medium text-gray-900 mb-2">System Health</h4>
                  <p className="text-sm text-gray-500 mb-4">
                    Check overall system health and performance
                  </p>
                  <button className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700">
                    Health Check
                  </button>
                </div>
                
                <div className="border rounded-lg p-4">
                  <h4 className="font-medium text-gray-900 mb-2">Logs</h4>
                  <p className="text-sm text-gray-500 mb-4">
                    View application logs and error reports
                  </p>
                  <button className="bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-700">
                    View Logs
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AdminPanel