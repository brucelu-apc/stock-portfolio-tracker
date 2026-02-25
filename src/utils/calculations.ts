export interface Holding {
  id: string
  user_id: string
  ticker: string
  name: string
  region: string
  shares: number
  cost_price: number
  buy_fee: number
  is_multiple: boolean
  buy_date: string
  strategy_mode: 'auto' | 'manual'
  high_watermark_price?: number
  manual_tp?: number
  manual_sl?: number
}

// ─── Taiwan Trading Cost Constants (2026) ───────────────────────
// Reference: https://www.twse.com.tw
const TW_COMMISSION_RATE = 0.001425   // 0.1425% — 買賣皆收
const TW_COMMISSION_MIN = 20          // 低消 20 元（整股）
const TW_STOCK_TAX_RATE = 0.003       // 0.3% — 證券交易稅（賣出時）
const TW_ETF_TAX_RATE = 0.001         // 0.1% — ETF 證交稅（賣出時）

/**
 * 判斷台股代號是否為 ETF
 * 台灣 ETF 代號規則：以 "0" 開頭的 4-6 碼（如 0050, 0056, 00878, 00713, 00991B）
 */
const isTaiwanETF = (ticker: string): boolean =>
  /^0\d{3,5}[A-Z]?$/.test(ticker)

/**
 * 計算台股賣出手續費（含低消邏輯）
 * @param marketValue 市值（股價 × 股數）
 * @returns 手續費金額
 */
const calcTwSellCommission = (marketValue: number): number =>
  Math.max(Math.round(marketValue * TW_COMMISSION_RATE), TW_COMMISSION_MIN)

/**
 * 計算台股證券交易稅（賣出時）
 * 股票: 0.3%, ETF: 0.1%
 * @param marketValue 市值
 * @param ticker 股票代號（用於判斷 ETF）
 * @returns 證交稅金額
 */
const calcTwSecuritiesTax = (marketValue: number, ticker: string): number => {
  const rate = isTaiwanETF(ticker) ? TW_ETF_TAX_RATE : TW_STOCK_TAX_RATE
  return Math.round(marketValue * rate)
}

export interface AggregatedHolding {
  user_id: string
  ticker: string
  name: string
  region: string
  sector: string
  totalShares: number
  avgCost: number
  totalCost: number                   // 持有成本 (含買進手續費), TWD
  currentPrice: number
  prevClose: number
  change: number
  changePercent: number
  // Separated realtime vs close price columns
  realtimePrice: number | null        // 即時股價 (from twstock, null when market closed)
  realtimeChange: number | null       // 即時漲跌點數
  realtimeChangePct: number | null    // 即時漲跌幅 %
  closePrice: number                  // 最新收盤價 (from yfinance)
  closeChange: number                 // 收盤漲跌點數
  closeChangePct: number              // 收盤漲跌幅 %
  marketValue: number                 // 股票市值 = 股價 × 股數 × 匯率, TWD
  // Trading costs breakdown
  totalBuyFee: number                 // 買進手續費合計, TWD
  estimatedSellCommission: number     // 預估賣出手續費, TWD
  estimatedSellTax: number            // 預估證交稅, TWD
  estimatedSellCost: number           // 預估賣出成本合計 = 手續費 + 證交稅, TWD
  estimatedNetProceeds: number        // 預估賣出淨收入 = 市值 - 賣出成本, TWD
  unrealizedPnl: number               // 預估損益 = 淨收入 - 持有成本, TWD
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
    const rawCost = items.reduce((sum, item) => sum + (item.shares * item.cost_price), 0)
    const totalBuyFee = items.reduce((sum, item) => sum + (item.buy_fee || 0), 0)
    const avgCost = totalShares > 0 ? rawCost / totalShares : 0

    // Get market data
    const mData = marketData[ticker] || {}
    const prevClose = mData.prev_close || 0
    const sector = mData.sector || "Unknown"

    // Separated realtime vs close prices
    const realtimePrice: number | null = mData.realtime_price || null
    const closePrice: number = mData.close_price || mData.current_price || avgCost

    // Best available price for PnL: realtime > close > current > avgCost
    const currentPrice = realtimePrice || closePrice || mData.current_price || avgCost

    const change = prevClose !== 0 ? currentPrice - prevClose : 0
    const changePercent = prevClose !== 0 ? (change / prevClose) * 100 : 0

    // Close change: points & percentage
    const closeChange = prevClose !== 0 ? closePrice - prevClose : 0
    const closeChangePct = prevClose !== 0 ? ((closePrice - prevClose) / prevClose) * 100 : 0

    // Realtime change: points & percentage vs CLOSE price (昨收)
    // 即時漲跌幅 = (即時價 - 昨收) / 昨收 — NOT prev_close (前天收盤)
    const realtimeChange = (realtimePrice !== null && closePrice > 0)
      ? (realtimePrice - closePrice)
      : null
    const realtimeChangePct = (realtimePrice !== null && closePrice > 0)
      ? ((realtimePrice - closePrice) / closePrice) * 100
      : null

    const fxRate = latest.region === 'US' ? (marketData['USDTWD']?.current_price || 32.5) : 1

    // ─── 市值與預估損益計算 ────────────────────────────────
    // Best available price for valuation
    const pnlPrice = realtimePrice || closePrice

    // 市值 = 目前股價 × 持有股數 (× 匯率)
    const rawMarketValue = pnlPrice * totalShares          // 原幣市值
    const marketValueTWD = rawMarketValue * fxRate          // TWD 市值

    // 持有成本 = Σ(股數 × 買進價) + Σ(買進手續費)
    const totalCostTWD = (rawCost + totalBuyFee) * fxRate
    const totalBuyFeeTWD = totalBuyFee * fxRate

    // 預估賣出成本（台股扣手續費 + 證交稅；美股暫不估算）
    let estimatedSellCommission = 0
    let estimatedSellTax = 0

    if (latest.region === 'TPE') {
      // 台股：手續費 0.1425% (低消 20 元) + 證交稅 0.3%/0.1%
      estimatedSellCommission = calcTwSellCommission(rawMarketValue)
      estimatedSellTax = calcTwSecuritiesTax(rawMarketValue, ticker)
    }
    // US stocks: most brokers charge $0 commission (Schwab, Fidelity, etc.)
    // User can extend here if needed for specific brokers

    const estimatedSellCost = (estimatedSellCommission + estimatedSellTax) * fxRate

    // 預估賣出淨收入 = 市值 - 賣出成本
    const estimatedNetProceeds = marketValueTWD - estimatedSellCost

    // 預估損益 = 淨收入 - 持有成本（含買進手續費）
    const unrealizedPnlTWD = estimatedNetProceeds - totalCostTWD

    // ROI = 損益 / 持有成本
    const roi = totalCostTWD > 0 ? (unrealizedPnlTWD / totalCostTWD) * 100 : 0

    return {
      user_id: latest.user_id,
      ticker,
      name: latest.name,
      region: latest.region,
      sector,
      totalShares,
      avgCost,
      totalCost: totalCostTWD,
      currentPrice,
      prevClose,
      change,
      changePercent,
      realtimePrice,
      realtimeChange,
      realtimeChangePct,
      closePrice,
      closeChange,
      closeChangePct,
      marketValue: marketValueTWD,
      totalBuyFee: totalBuyFeeTWD,
      estimatedSellCommission: estimatedSellCommission * fxRate,
      estimatedSellTax: estimatedSellTax * fxRate,
      estimatedSellCost,
      estimatedNetProceeds,
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
