import React from 'react'

const TestPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-card flex items-center justify-center">
      <div className="max-w-md w-full bg-card rounded-lg shadow-md p-6">
        <h1 className="text-2xl font-bold text-center mb-4">
          🎉 App is Working!
        </h1>
        <div className="text-center text-muted">
          <p>The application is loading correctly.</p>
          <p className="mt-2 text-sm">
            Environment: {import.meta.env.MODE}
          </p>
          <p className="text-sm">
            Has Database URL: {import.meta.env.DATABASE_URL ? '✅' : '❌'}
          </p>
          <p className="text-sm">
            Has Stripe Key: {import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ? '✅' : '❌'}
          </p>
        </div>
      </div>
    </div>
  )
}

export default TestPage