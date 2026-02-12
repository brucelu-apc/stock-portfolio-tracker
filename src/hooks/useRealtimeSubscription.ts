/**
 * useRealtimeSubscription — Supabase Realtime hook for live data updates.
 *
 * Subscribes to:
 *  - market_data table (INSERT/UPDATE) → live price updates
 *  - price_alerts table (INSERT) → new alert notifications
 *  - price_targets table (INSERT/UPDATE) → target changes
 *  - advisory_tracking table (UPDATE) → tracking status changes
 *
 * Architecture Note:
 *  Single channel approach — all table subscriptions go through one
 *  Realtime channel to minimize WebSocket connections. Each table
 *  gets its own event handler via `.on('postgres_changes', ...)`.
 */
import { useEffect, useRef, useCallback } from 'react'
import { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../services/supabase'

export interface RealtimeCallbacks {
  onMarketDataChange?: (payload: any) => void
  onNewAlert?: (payload: any) => void
  onPriceTargetChange?: (payload: any) => void
  onTrackingChange?: (payload: any) => void
}

/**
 * Hook that sets up Supabase Realtime subscriptions for advisory monitoring.
 *
 * @param callbacks - Object with handler functions for each table event
 * @param enabled - Whether to activate subscriptions (default: true)
 * @returns Object with channel status info
 *
 * Usage:
 * ```tsx
 * useRealtimeSubscription({
 *   onMarketDataChange: (payload) => updatePriceMap(payload.new),
 *   onNewAlert: (payload) => addAlert(payload.new),
 * })
 * ```
 */
export function useRealtimeSubscription(
  callbacks: RealtimeCallbacks,
  enabled = true
) {
  const channelRef = useRef<RealtimeChannel | null>(null)
  // Store callbacks in ref to avoid re-subscribing on every render
  const callbacksRef = useRef(callbacks)
  callbacksRef.current = callbacks

  const setupChannel = useCallback(() => {
    // Clean up existing channel before creating a new one
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
      channelRef.current = null
    }

    if (!enabled) return

    const channel = supabase
      .channel('advisory-realtime')
      // ── market_data changes (price updates from twstock/yfinance) ──
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'market_data',
        },
        (payload) => {
          callbacksRef.current.onMarketDataChange?.(payload)
        }
      )
      // ── price_alerts inserts (new triggered alerts) ──
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'price_alerts',
        },
        (payload) => {
          callbacksRef.current.onNewAlert?.(payload)
        }
      )
      // ── price_targets changes (new/updated targets after import) ──
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'price_targets',
        },
        (payload) => {
          callbacksRef.current.onPriceTargetChange?.(payload)
        }
      )
      // ── advisory_tracking status changes ──
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'advisory_tracking',
        },
        (payload) => {
          callbacksRef.current.onTrackingChange?.(payload)
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Realtime] Advisory channel subscribed')
        } else if (status === 'CHANNEL_ERROR') {
          console.error('[Realtime] Advisory channel error')
        }
      })

    channelRef.current = channel
  }, [enabled])

  useEffect(() => {
    setupChannel()

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [setupChannel])

  return {
    isConnected: !!channelRef.current,
  }
}
