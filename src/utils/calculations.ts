export interface Holding {
  id: string
  ticker: string
  name: string
  region: string
  shares: number
  cost_price: number
  is_multiple: boolean
  buy_date: string
  strategy_mode: 'auto' | 'manual'
  high_watermark_price?: number
  manual_tp?: number
  manual_sl?: number
}

export interface AggregatedHolding {
  ticker: string
  name: string
  region: string
  totalShares: number
  avgCost: number
  totalCost: number
  currentPrice: number // Added real price
  marketValue: number  // Added calculated value
  unrealizedPnl: number // Added calculated PnL
  roi: number          // Added calculated ROI
  latestDate: string
  isMultiple: boolean
  strategyMode: 'auto' | 'manual'
  highWatermark: number
  manualTP?: number
  manualSL?: number
  items: Holding[]
}

export const aggregateHoldings = (holdings: Holding[], priceMap: { [ticker: string]: number }): AggregatedHolding[] => {
  const groups: { [key: string]: Holding[] } = {}
  
  holdings.forEach(h => {
    if (!groups[h.ticker]) groups[h.ticker] = []
    groups[h.ticker].push(h)
  })

  return Object.keys(groups).map(ticker => {
    const items = groups[ticker].sort((a, b) => 
      new Date(b.buy_date).getTime() - new Date(a.buy_date).getTime()
    )
    
    const latest = items[0]
    const totalShares = items.reduce((sum, item) => sum + item.shares, 0)
    const totalCost = items.reduce((sum, item) => sum + (item.shares * item.cost_price), 0)
    const avgCost = totalShares > 0 ? totalCost / totalShares : 0

    // Get real price from map, fallback to avgCost if missing (0% PnL) to avoid NaN
    const currentPrice = priceMap[ticker] || avgCost 
    const fxRate = region === 'US' ? (priceMap['USDTWD'] || 32.5) : 1
    
    // Values in TWD for summary consistency
    const totalCostTWD = totalCost * fxRate
    const marketValueTWD = (currentPrice * totalShares) * fxRate
    const unrealizedPnlTWD = marketValueTWD - totalCostTWD
    const roi = totalCost > 0 ? (unrealizedPnlTWD / totalCostTWD) * 100 : 0

    return {
      ticker,
      name: latest.name,
      region: latest.region,
      totalShares,
      avgCost,
      totalCost: totalCostTWD, // Now in TWD
      currentPrice,
      marketValue: marketValueTWD, // Now in TWD
      unrealizedPnl: unrealizedPnlTWD, // Now in TWD
      roi,
      latestDate: latest.buy_date,
      isMultiple: items.length > 1,
      strategyMode: latest.strategy_mode,
      highWatermark: latest.high_watermark_price || avgCost,
      manualTP: latest.manual_tp,
      manualSL: latest.manual_sl,
      items
    }
  })
}

export const calculateTPSL = (holding: AggregatedHolding) => {
  if (holding.strategyMode === 'manual') {
    return {
      tp: holding.manualTP || holding.avgCost * 1.1,
      sl: holding.manualSL || holding.avgCost
    }
  }

  // Auto Trailing logic: MAX(Cost * 1.1, HighWatermark * 0.9)
  const baseTP = holding.avgCost * 1.1
  const trailingTP = (holding.highWatermark || holding.avgCost) * 0.9
  
  return {
    tp: Math.max(baseTP, trailingTP),
    sl: holding.avgCost // Breakeven
  }
}
