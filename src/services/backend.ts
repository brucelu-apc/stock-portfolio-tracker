/**
 * Backend API client for Railway FastAPI service.
 * Handles communication with the advisory notification backend.
 */

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'

// ─── Types ──────────────────────────────────────────────────

export interface ParsedStock {
  ticker: string
  name: string
  defense_price: number | null
  min_target_low: number | null
  min_target_high: number | null
  reasonable_target_low: number | null
  reasonable_target_high: number | null
  entry_price: number | null
  strategy_notes: string
}

export interface ParsedMessage {
  message_type: string
  raw_text: string
  stocks: ParsedStock[]
  market_support: number | null
  market_resistance: number | null
}

export interface ParseResponse {
  success: boolean
  total_messages: number
  total_stocks: number
  messages: ParsedMessage[]
  dates_found: string[]
}

export interface ImportResponse {
  success: boolean
  imported_count: number
  skipped_count: number
  details: Array<{
    ticker: string
    name: string
    action: string
    defense_price?: number
    min_target?: string
    reason?: string
  }>
}

export interface ForwardTarget {
  id: string
  user_id: string
  platform: 'line' | 'telegram'
  target_id: string
  target_name: string
  target_type: 'user' | 'group'
  is_default: boolean
  created_at: string
}

export interface ForwardResult {
  target_name: string
  platform: string
  success: boolean
  error: string
}

export interface ForwardResponse {
  success: boolean
  total_targets: number
  sent_count: number
  failed_count: number
  results: ForwardResult[]
}

export interface RegistrationNotifyRequest {
  user_id: string
  email: string
  display_name?: string
  phone?: string
  company?: string
  notes?: string
}

// ─── API calls ──────────────────────────────────────────────

/**
 * Parse notification text (preview only, no DB write).
 */
export async function parseNotification(text: string, source = 'dashboard'): Promise<ParseResponse> {
  const response = await fetch(`${BACKEND_URL}/api/parse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, source }),
  })

  if (!response.ok) {
    throw new Error(`Parse failed: ${response.status} ${response.statusText}`)
  }

  return response.json()
}

/**
 * Parse and import notification into Supabase.
 */
export async function importNotification(
  text: string,
  userId: string,
  selectedTickers: string[] = [],
  source = 'dashboard'
): Promise<ImportResponse> {
  const response = await fetch(`${BACKEND_URL}/api/parse/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      source,
      user_id: userId,
      selected_tickers: selectedTickers,
    }),
  })

  if (!response.ok) {
    throw new Error(`Import failed: ${response.status} ${response.statusText}`)
  }

  return response.json()
}

/**
 * Health check for backend availability.
 */
export async function checkBackendHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${BACKEND_URL}/health`, { method: 'GET' })
    return response.ok
  } catch {
    return false
  }
}

// ─── Forward API ────────────────────────────────────────────

/**
 * Get all forward targets for a user.
 */
export async function getForwardTargets(userId: string): Promise<ForwardTarget[]> {
  const response = await fetch(`${BACKEND_URL}/api/forward/targets?user_id=${userId}`)
  if (!response.ok) throw new Error(`Failed to get targets: ${response.status}`)
  const data = await response.json()
  return data.targets || []
}

/**
 * Add a new forward target.
 */
export async function addForwardTarget(
  userId: string,
  platform: 'line' | 'telegram',
  targetId: string,
  targetName: string,
  targetType: 'user' | 'group' = 'user',
  isDefault: boolean = false,
): Promise<ForwardTarget | null> {
  const params = new URLSearchParams({
    user_id: userId,
    platform,
    target_id: targetId,
    target_name: targetName,
    target_type: targetType,
    is_default: String(isDefault),
  })
  const response = await fetch(`${BACKEND_URL}/api/forward/targets?${params}`, {
    method: 'POST',
  })
  if (!response.ok) throw new Error(`Failed to add target: ${response.status}`)
  const data = await response.json()
  return data.target || null
}

/**
 * Delete a forward target.
 */
export async function deleteForwardTarget(targetId: string, userId: string): Promise<void> {
  const response = await fetch(
    `${BACKEND_URL}/api/forward/targets/${targetId}?user_id=${userId}`,
    { method: 'DELETE' }
  )
  if (!response.ok) throw new Error(`Failed to delete target: ${response.status}`)
}

/**
 * Forward selected stocks to targets.
 */
export async function forwardStocks(
  userId: string,
  stocks: ParsedStock[],
  targets: Array<{
    forward_target_id?: string
    platform: string
    target_id: string
    target_name: string
  }>,
  senderName: string = 'Stock Tracker',
): Promise<ForwardResponse> {
  const response = await fetch(`${BACKEND_URL}/api/forward`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: userId,
      stocks,
      targets,
      sender_name: senderName,
    }),
  })

  if (!response.ok) throw new Error(`Forward failed: ${response.status}`)
  return response.json()
}

// ─── Registration API ───────────────────────────────────────

/**
 * Notify admins about a new user registration via email.
 */
export async function notifyRegistration(info: RegistrationNotifyRequest): Promise<any> {
  const response = await fetch(`${BACKEND_URL}/api/registrations/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(info),
  })

  if (!response.ok) {
    throw new Error(`Notification failed: ${response.status} ${response.statusText}`)
  }

  return response.json()
}
