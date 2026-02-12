/**
 * MessagingSettings — Manage LINE and Telegram notification bindings and preferences.
 *
 * Features:
 *  - View bound LINE / Telegram accounts
 *  - Toggle notification channels (LINE / Telegram)
 *  - Configure per-alert-type preferences
 *  - Link instructions for each platform
 */
import { useState, useEffect, useCallback } from 'react'
import {
  Box,
  VStack,
  HStack,
  Text,
  Switch,
  Badge,
  Divider,
  Flex,
  useToast,
  Spinner,
  Accordion,
  AccordionItem,
  AccordionButton,
  AccordionPanel,
  AccordionIcon,
  Code,
} from '@chakra-ui/react'
import { supabase } from '../../services/supabase'

interface MessagingSettingsProps {
  userId: string
}

interface UserMessaging {
  user_id: string
  line_user_id: string | null
  telegram_chat_id: number | null
  notification_prefs: NotificationPrefs | null
}

interface NotificationPrefs {
  line_enabled: boolean
  telegram_enabled: boolean
  defense_alert: boolean
  min_target_alert: boolean
  reasonable_target_alert: boolean
  tp_sl_alert: boolean
}

const DEFAULT_PREFS: NotificationPrefs = {
  line_enabled: true,
  telegram_enabled: true,
  defense_alert: true,
  min_target_alert: true,
  reasonable_target_alert: true,
  tp_sl_alert: true,
}

const ALERT_TYPE_LABELS: Record<string, { label: string; description: string; emoji: string }> = {
  defense_alert: {
    label: '防守價警示',
    description: '股價跌破防守價時通知',
    emoji: '🛡',
  },
  min_target_alert: {
    label: '最小目標警示',
    description: '股價達到最小漲幅目標時通知',
    emoji: '📈',
  },
  reasonable_target_alert: {
    label: '合理目標警示',
    description: '股價達到合理漲幅目標時通知',
    emoji: '🎯',
  },
  tp_sl_alert: {
    label: '停利停損警示',
    description: '持股觸發停利或停損條件時通知',
    emoji: '⚠️',
  },
}

export const MessagingSettings = ({ userId }: MessagingSettingsProps) => {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [messaging, setMessaging] = useState<UserMessaging | null>(null)
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS)

  // Load user messaging data
  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('user_messaging')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle()

      if (error) {
        throw error
      }

      if (data) {
        setMessaging(data)
        setPrefs({ ...DEFAULT_PREFS, ...(data.notification_prefs || {}) })
      }
    } catch (err: any) {
      toast({
        title: '載入通知設定失敗',
        description: err.message,
        status: 'error',
        duration: 3000,
      })
    } finally {
      setLoading(false)
    }
  }, [userId, toast])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Save preferences
  const savePrefs = async (newPrefs: NotificationPrefs) => {
    setSaving(true)
    try {
      const { error } = await supabase
        .from('user_messaging')
        .upsert(
          {
            user_id: userId,
            notification_prefs: newPrefs,
          },
          { onConflict: 'user_id' }
        )

      if (error) throw error

      setPrefs(newPrefs)
      toast({ title: '設定已更新', status: 'success', duration: 2000 })
    } catch (err: any) {
      toast({
        title: '儲存失敗',
        description: err.message,
        status: 'error',
        duration: 3000,
      })
    } finally {
      setSaving(false)
    }
  }

  const togglePref = (key: keyof NotificationPrefs) => {
    const newPrefs = { ...prefs, [key]: !prefs[key] }
    setPrefs(newPrefs)
    savePrefs(newPrefs)
  }

  if (loading) {
    return (
      <Flex justify="center" py={8}>
        <Spinner color="blue.500" />
      </Flex>
    )
  }

  return (
    <VStack spacing={6} align="stretch">
      <Text fontWeight="bold" fontSize="lg">
        通知管道設定
      </Text>

      {/* Platform Status */}
      <VStack spacing={4} align="stretch">
        {/* LINE */}
        <Flex
          p={4}
          bg="white"
          rounded="xl"
          border="1px solid"
          borderColor="gray.200"
          align="center"
          justify="space-between"
        >
          <HStack spacing={3}>
            <Text fontSize="xl">💬</Text>
            <VStack align="start" spacing={0}>
              <HStack spacing={2}>
                <Text fontWeight="bold">LINE</Text>
                {messaging?.line_user_id ? (
                  <Badge colorScheme="green" rounded="full">
                    已綁定
                  </Badge>
                ) : (
                  <Badge colorScheme="gray" rounded="full">
                    未綁定
                  </Badge>
                )}
              </HStack>
              <Text fontSize="xs" color="gray.500">
                {messaging?.line_user_id
                  ? `ID: ${messaging.line_user_id.substring(0, 12)}...`
                  : '加入 LINE Bot 好友即自動綁定'}
              </Text>
            </VStack>
          </HStack>
          <Switch
            colorScheme="green"
            isChecked={prefs.line_enabled}
            onChange={() => togglePref('line_enabled')}
            isDisabled={!messaging?.line_user_id || saving}
          />
        </Flex>

        {/* Telegram */}
        <Flex
          p={4}
          bg="white"
          rounded="xl"
          border="1px solid"
          borderColor="gray.200"
          align="center"
          justify="space-between"
        >
          <HStack spacing={3}>
            <Text fontSize="xl">✈️</Text>
            <VStack align="start" spacing={0}>
              <HStack spacing={2}>
                <Text fontWeight="bold">Telegram</Text>
                {messaging?.telegram_chat_id ? (
                  <Badge colorScheme="blue" rounded="full">
                    已綁定
                  </Badge>
                ) : (
                  <Badge colorScheme="gray" rounded="full">
                    未綁定
                  </Badge>
                )}
              </HStack>
              <Text fontSize="xs" color="gray.500">
                {messaging?.telegram_chat_id
                  ? `Chat ID: ${messaging.telegram_chat_id}`
                  : '在 Telegram Bot 輸入 /link <email> 綁定'}
              </Text>
            </VStack>
          </HStack>
          <Switch
            colorScheme="blue"
            isChecked={prefs.telegram_enabled}
            onChange={() => togglePref('telegram_enabled')}
            isDisabled={!messaging?.telegram_chat_id || saving}
          />
        </Flex>
      </VStack>

      <Divider />

      {/* Alert Type Preferences */}
      <Text fontWeight="bold" fontSize="lg">
        警示類型設定
      </Text>

      <VStack spacing={3} align="stretch">
        {Object.entries(ALERT_TYPE_LABELS).map(([key, config]) => (
          <Flex
            key={key}
            p={4}
            bg="white"
            rounded="xl"
            border="1px solid"
            borderColor="gray.200"
            align="center"
            justify="space-between"
          >
            <HStack spacing={3}>
              <Text fontSize="lg">{config.emoji}</Text>
              <VStack align="start" spacing={0}>
                <Text fontWeight="bold" fontSize="sm">
                  {config.label}
                </Text>
                <Text fontSize="xs" color="gray.500">
                  {config.description}
                </Text>
              </VStack>
            </HStack>
            <Switch
              colorScheme="blue"
              isChecked={prefs[key as keyof NotificationPrefs] as boolean}
              onChange={() => togglePref(key as keyof NotificationPrefs)}
              isDisabled={saving}
            />
          </Flex>
        ))}
      </VStack>

      <Divider />

      {/* Binding Instructions */}
      <Accordion allowToggle>
        <AccordionItem border="none">
          <AccordionButton
            px={0}
            _hover={{ bg: 'transparent' }}
            _expanded={{ fontWeight: 'bold' }}
          >
            <Text flex="1" textAlign="left" fontSize="sm" color="gray.600">
              如何綁定通知帳號？
            </Text>
            <AccordionIcon />
          </AccordionButton>
          <AccordionPanel px={0} pb={4}>
            <VStack spacing={4} align="stretch">
              <Box bg="green.50" p={4} rounded="xl">
                <Text fontWeight="bold" mb={2}>
                  💬 LINE 綁定方式
                </Text>
                <VStack align="start" spacing={1}>
                  <Text fontSize="sm">
                    1. 加入 Stock Tracker LINE Bot 為好友
                  </Text>
                  <Text fontSize="sm">2. 系統自動綁定您的 LINE 帳號</Text>
                  <Text fontSize="sm">3. 開始接收即時價格警示推播</Text>
                  <Text fontSize="xs" color="gray.500" mt={1}>
                    注意：LINE 免費方案每月限 500 則推播
                  </Text>
                </VStack>
              </Box>

              <Box bg="blue.50" p={4} rounded="xl">
                <Text fontWeight="bold" mb={2}>
                  ✈️ Telegram 綁定方式
                </Text>
                <VStack align="start" spacing={1}>
                  <Text fontSize="sm">
                    1. 搜尋 Stock Tracker Bot 並開啟對話
                  </Text>
                  <Text fontSize="sm">
                    2. 輸入{' '}
                    <Code fontSize="sm">/link your@email.com</Code>
                  </Text>
                  <Text fontSize="sm">3. 綁定成功後即可接收警示</Text>
                  <Text fontSize="xs" color="blue.600" mt={1}>
                    Telegram 無訊息數量限制，建議優先使用
                  </Text>
                </VStack>
              </Box>
            </VStack>
          </AccordionPanel>
        </AccordionItem>
      </Accordion>
    </VStack>
  )
}
