import React from 'react'
import { Coins, Plus } from 'lucide-react'
import { Link } from 'react-router-dom'

interface ITCBalanceProps {
  balance: number
}

export default function ITCBalance({ balance }: ITCBalanceProps) {
  const formattedBalance = balance.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })

  const isLowBalance = balance < 10

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted uppercase tracking-wide">
          ITC Balance
        </span>
        <Coins className="w-4 h-4 text-primary" />
      </div>

      {/* Balance Display */}
      <div className={`
        p-4 rounded-lg border-2 transition-all
        ${isLowBalance
          ? 'bg-yellow-500/10 border-yellow-500/30'
          : 'bg-primary/10 border-primary/30'
        }
      `}>
        <div className="flex items-baseline gap-2">
          <span className={`
            text-2xl font-bold
            ${isLowBalance ? 'text-yellow-400' : 'text-primary'}
          `}>
            {formattedBalance}
          </span>
          <span className={`
            text-sm
            ${isLowBalance ? 'text-yellow-400/70' : 'text-primary/70'}
          `}>
            ITC
          </span>
        </div>

        {isLowBalance && (
          <div className="mt-2 text-xs text-yellow-400/80 flex items-center gap-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
            Low balance
          </div>
        )}
      </div>

      {/* Add ITC Button */}
      <Link
        to="/wallet"
        className="w-full px-4 py-2.5 bg-primary hover:bg-primary/90 text-white font-medium rounded-lg flex items-center justify-center gap-2 transition-colors group"
      >
        <Plus className="w-4 h-4 group-hover:scale-110 transition-transform" />
        Add ITC
      </Link>

      {/* Pricing Info */}
      <div className="pt-3 border-t border-primary/10">
        <div className="text-xs text-muted space-y-1">
          <div className="flex justify-between">
            <span>Mr. Imagine:</span>
            <span className="text-text font-medium">5 ITC</span>
          </div>
          <div className="flex justify-between">
            <span>ITP Enhance:</span>
            <span className="text-text font-medium">3 ITC</span>
          </div>
        </div>
      </div>
    </div>
  )
}
