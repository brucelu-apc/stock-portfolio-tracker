/**
 * AlertPanel — Real-time price alert notifications.
 *
 * Displays triggered price alerts from the backend monitor:
 *  - defense_breach: Stock dropped below defense price (RED)
 *  - min_target_reached: Stock hit minimum target (GREEN)
 *  - reasonable_target_reached: Stock hit reasonable target (GOLD)
 *  - tp_triggered: Take-profit hit (BLUE)
 *  - sl_triggered: Stop-loss hit (RED)
 *
 * Features:
 *  - Live updates via Supabase Realtime subscription
 *  - Acknowledge (mark as read) button per alert
 *  - Dismiss all read alerts
 *  - Animated entrance via framer-motion
 */
import { useState, useEffect, useCallback } from 'react'
import {
  Box,
  VStack,
  HStack,
  Text,
  Flex,
  Badge,
  IconButton,
  Button,
  Tooltip,
  useToast,
} from '@chakra-ui/react'
import { CheckIcon, BellIcon } from '@chakra-ui/icons'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../../services/supabase'
import { useRealtimeSubscription } from '../../hooks/useRealtimeSubscription'

// ─── Types ──────────────────────────────────────────────────

interface PriceAlert {
  id: string
  user_id: string
  ticker: string
  alert_type: string
  trigger_price: number
  current_price: number
  notified_via: string[]
  triggered_at: string
  acknowledged: boolean
}

// ─── Alert type display config ──────────────────────────────

const ALERT_TYPE_CONFIG: Record<string, { label: string; color: string; emoji: string }> = {
  defense_breach: { label: '跌破防守價', color: 'red', emoji: '🔴' },
  min_target_reached: { label: '達最小目標', color: 'green', emoji: '🟢' },
  reasonable_target_reached: { label: '達合理目標', color: 'yellow', emoji: '🟡' },
  tp_triggered: { label: '停利觸發', color: 'blue', emoji: '🔵' },
  sl_triggered: { label: '停損觸發', color: 'red', emoji: '🔴' },
}

const MotionBox = motion(Box)

// ─── Component ──────────────────────────────────────────────

interface AlertPanelProps {
  userId: string
  maxAlerts?: number
}

export const AlertPanel = ({ userId: _userId, maxAlerts = 20 }: AlertPanelProps) => {
  const toast = useToast()
  const [alerts, setAlerts] = useState<PriceAlert[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // ── Fetch initial alerts ──

  const fetchAlerts = useCallback(async () => {
    setIsLoading(true)
    try {
      const { data, error } = await supabase
        .from('price_alerts')
        .select('*')
        .order('triggered_at', { ascending: false })
        .limit(maxAlerts)

      if (error) {
        console.error('Failed to fetch alerts:', error)
      } else {
        setAlerts(data || [])
      }
    } catch (err) {
      console.error('Alerts fetch error:', err)
    } finally {
      setIsLoading(false)
    }
  }, [maxAlerts])

  useEffect(() => {
    fetchAlerts()
  }, [fetchAlerts])

  // ── Realtime: new alerts arrive instantly ──

  useRealtimeSubscription({
    onNewAlert: (payload) => {
      const newAlert = payload.new as PriceAlert
      setAlerts((prev) => {
        // Prepend new alert, keep within maxAlerts limit
        const updated = [newAlert, ...prev].slice(0, maxAlerts)
        return updated
      })

      // Show toast for new alert
      const config = ALERT_TYPE_CONFIG[newAlert.alert_type] || ALERT_TYPE_CONFIG.defense_breach
      toast({
        title: `${config.emoji} ${newAlert.ticker} ${config.label}`,
        description: `觸發價: ${newAlert.trigger_price} | 現價: ${newAlert.current_price}`,
        status: newAlert.alert_type.includes('breach') || newAlert.alert_type.includes('sl')
          ? 'error'
          : 'success',
        duration: 8000,
        isClosable: true,
        position: 'top-right',
      })
    },
  })

  // ── Acknowledge a single alert ──

  const acknowledgeAlert = async (alertId: string) => {
    const { error } = await supabase
      .from('price_alerts')
      .update({ acknowledged: true })
      .eq('id', alertId)

    if (!error) {
      setAlerts((prev) =>
        prev.map((a) => (a.id === alertId ? { ...a, acknowledged: true } : a))
      )
    }
  }

  // ── Acknowledge all unread alerts ──

  const acknowledgeAll = async () => {
    const unacknowledged = alerts.filter((a) => !a.acknowledged).map((a) => a.id)
    if (unacknowledged.length === 0) return

    const { error } = await supabase
      .from('price_alerts')
      .update({ acknowledged: true })
      .in('id', unacknowledged)

    if (!error) {
      setAlerts((prev) => prev.map((a) => ({ ...a, acknowledged: true })))
      toast({
        title: '全部已讀',
        status: 'info',
        duration: 2000,
      })
    }
  }

  // ── Counts ──

  const unreadCount = alerts.filter((a) => !a.acknowledged).length

  // ── Format time ──

  const formatTime = (ts: string) => {
    const d = new Date(ts)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMin = Math.floor(diffMs / 60000)

    if (diffMin < 1) return '剛剛'
    if (diffMin < 60) return `${diffMin} 分鐘前`
    if (diffMin < 1440) return `${Math.floor(diffMin / 60)} 小時前`
    return d.toLocaleDateString('zh-TW', { month: 'short', day: 'numeric' })
  }

  return (
    <Box bg="white" p={{ base: 4, md: 6 }} rounded="3xl" shadow="2xl" border="1px" borderColor="gray.50">
      {/* Header */}
      <Flex justify="space-between" align="center" mb={4}>
        <HStack spacing={3}>
          <BellIcon boxSize={5} color="brand.500" />
          <Text fontSize="lg" fontWeight="extrabold" color="ui.navy">
            價格警示
          </Text>
          {unreadCount > 0 && (
            <Badge colorScheme="red" rounded="full" px={2} py={0.5} fontSize="xs">
              {unreadCount} 未讀
            </Badge>
          )}
        </HStack>
        {unreadCount > 0 && (
          <Button size="xs" variant="ghost" onClick={acknowledgeAll} rounded="lg">
            全部已讀
          </Button>
        )}
      </Flex>

      {/* Alert list */}
      <VStack spacing={2} align="stretch" maxH="400px" overflowY="auto">
        <AnimatePresence mode="popLayout">
          {alerts.length === 0 && !isLoading ? (
            <Box py={8} textAlign="center">
              <Text color="ui.slate" fontSize="sm">目前沒有價格警示</Text>
              <Text color="gray.400" fontSize="xs" mt={1}>
                當股價觸及防守價或目標價時，將會即時通知
              </Text>
            </Box>
          ) : (
            alerts.map((alert) => {
              const config = ALERT_TYPE_CONFIG[alert.alert_type] || ALERT_TYPE_CONFIG.defense_breach
              const isDanger = alert.alert_type === 'defense_breach' || alert.alert_type === 'sl_triggered'

              return (
                <MotionBox
                  key={alert.id}
                  initial={{ opacity: 0, x: 20, scale: 0.95 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  exit={{ opacity: 0, x: -20, scale: 0.95 }}
                  transition={{ duration: 0.3 }}
                  layout
                >
                  <Box
                    p={3}
                    bg={alert.acknowledged ? 'gray.50' : isDanger ? 'red.50' : 'green.50'}
                    rounded="xl"
                    border="1px solid"
                    borderColor={alert.acknowledged ? 'gray.100' : isDanger ? 'red.200' : 'green.200'}
                    opacity={alert.acknowledged ? 0.7 : 1}
                    transition="all 0.2s"
                  >
                    <Flex justify="space-between" align="start">
                      <HStack spacing={3} flex={1}>
                        {/* Alert type indicator */}
                        <Badge
                          colorScheme={config.color}
                          rounded="lg"
                          px={2}
                          py={1}
                          fontSize="10px"
                          fontWeight="bold"
                          minW="70px"
                          textAlign="center"
                        >
                          {config.label}
                        </Badge>

                        {/* Alert details */}
                        <VStack align="start" spacing={0} flex={1}>
                          <HStack spacing={2}>
                            <Text fontWeight="extrabold" color="ui.navy" fontSize="sm">
                              {alert.ticker}
                            </Text>
                            <Text fontSize="xs" color="ui.slate">
                              {formatTime(alert.triggered_at)}
                            </Text>
                          </HStack>
                          <HStack spacing={3} fontSize="xs">
                            <Text color="ui.slate">
                              觸發價: <Text as="span" fontWeight="bold" color={isDanger ? 'red.600' : 'green.600'}>
                                {alert.trigger_price}
                              </Text>
                            </Text>
                            <Text color="ui.slate">
                              現價: <Text as="span" fontWeight="bold">{alert.current_price}</Text>
                            </Text>
                            {alert.notified_via?.length > 0 && (
                              <HStack spacing={1}>
                                {alert.notified_via.map((via) => (
                                  <Badge key={via} size="sm" variant="outline" fontSize="9px" rounded="full">
                                    {via}
                                  </Badge>
                                ))}
                              </HStack>
                            )}
                          </HStack>
                        </VStack>
                      </HStack>

                      {/* Acknowledge button */}
                      {!alert.acknowledged && (
                        <Tooltip label="標記已讀">
                          <IconButton
                            aria-label="Acknowledge"
                            icon={<CheckIcon />}
                            size="xs"
                            variant="ghost"
                            colorScheme={isDanger ? 'red' : 'green'}
                            onClick={() => acknowledgeAlert(alert.id)}
                            rounded="full"
                          />
                        </Tooltip>
                      )}
                    </Flex>
                  </Box>
                </MotionBox>
              )
            })
          )}
        </AnimatePresence>
      </VStack>
    </Box>
  )
}
