export interface Holding {
  id: string
  user_id: string
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
  currentPrice: number
  prevClose: number
  change: number
  changePercent: number
  marketValue: number
  unrealizedPnl: number
  roi: number
  latestDate: string
  isMultiple: boolean
  strategyMode: 'auto' | 'manual'
  highWatermark: number
  manualTP?: number
  manualSL?: number
  items: Holding[]
}

export const aggregateHoldings = (holdings: Holding[], marketData: { [ticker: string]: any }): AggregatedHolding[] => {
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

    // Get market data
    const mData = marketData[ticker] || {}
    const currentPrice = mData.current_price || avgCost
    const prevClose = mData.prev_close || currentPrice
    
    const change = currentPrice - prevClose
    const changePercent = prevClose !== 0 ? (change / prevClose) * 100 : 0

    const fxRate = latest.region === 'US' ? (marketData['USDTWD']?.current_price || 32.5) : 1
    
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
      totalCost: totalCostTWD,
      currentPrice,
      prevClose,
      change,
      changePercent,
      marketValue: marketValueTWD,
      unrealizedPnl: unrealizedPnlTWD,
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
