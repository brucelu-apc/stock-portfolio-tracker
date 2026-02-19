/**
 * StockForwardModal — Modal for managing forward targets and forwarding stocks.
 *
 * Two modes:
 *  1. "forward" mode (default): Select targets and send immediately
 *  2. "manage" mode: Manage the quick-forward list (add/remove from 轉發清單)
 *
 * The quick-forward list uses the `is_default` flag on forward_targets.
 * Targets in the list are used by the "轉發" quick-send button in ParsePreview.
 */
import { useState, useEffect, useCallback } from 'react'
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  VStack,
  HStack,
  Text,
  Button,
  Checkbox,
  Badge,
  Box,
  Flex,
  Input,
  Select,
  useToast,
  Divider,
  Spinner,
  Switch,
  IconButton,
  Tooltip,
  ButtonGroup,
} from '@chakra-ui/react'
import { DeleteIcon } from '@chakra-ui/icons'
import {
  type ParsedStock,
  type ForwardTarget,
  getForwardTargets,
  addForwardTarget,
  deleteForwardTarget,
  forwardStocks,
  toggleForwardList,
} from '../../services/backend'
import { supabase } from '../../services/supabase'

/** A registered messaging user from the user_messaging directory */
interface MessagingUser {
  user_id: string
  email: string
  line_user_id: string | null
  telegram_chat_id: number | null
  created_at: string
}

type ModalMode = 'forward' | 'manage'

interface StockForwardModalProps {
  isOpen: boolean
  onClose: () => void
  stocks: ParsedStock[]
  userId: string
  /** Initial mode: 'forward' to select & send, 'manage' to edit the quick list */
  initialMode?: ModalMode
}

const PLATFORM_CONFIG = {
  line: { label: 'LINE', color: 'green', emoji: '💬' },
  telegram: { label: 'Telegram', color: 'blue', emoji: '✈️' },
}

export const StockForwardModal = ({
  isOpen,
  onClose,
  stocks,
  userId,
  initialMode = 'forward',
}: StockForwardModalProps) => {
  const toast = useToast()
  const [mode, setMode] = useState<ModalMode>(initialMode)
  const [targets, setTargets] = useState<ForwardTarget[]>([])
  const [selectedTargets, setSelectedTargets] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [forwarding, setForwarding] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)

  // Add target form state
  const [newPlatform, setNewPlatform] = useState<'line' | 'telegram'>('telegram')
  const [newTargetId, setNewTargetId] = useState('')
  const [newTargetName, setNewTargetName] = useState('')
  const [newTargetType, setNewTargetType] = useState<'user' | 'group'>('user')

  // Directory dropdown state
  const [inputMode, setInputMode] = useState<'manual' | 'select'>('manual')
  const [messagingUsers, setMessagingUsers] = useState<MessagingUser[]>([])
  const [loadingDirectory, setLoadingDirectory] = useState(false)

  // Reset mode when modal opens
  useEffect(() => {
    if (isOpen) {
      setMode(initialMode)
    }
  }, [isOpen, initialMode])

  // Load forward targets
  const loadTargets = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    try {
      const data = await getForwardTargets(userId)
      setTargets(data)
      // Auto-select defaults for forward mode
      const defaults = new Set(
        data.filter((t) => t.is_default).map((t) => t.id)
      )
      setSelectedTargets(defaults)
    } catch (err: any) {
      toast({
        title: '載入轉發目標失敗',
        description: err.message,
        status: 'error',
        duration: 3000,
      })
    } finally {
      setLoading(false)
    }
  }, [userId, toast])

  useEffect(() => {
    if (isOpen) {
      loadTargets()
    }
  }, [isOpen, loadTargets])

  // Load messaging directory when add form opens in "select" mode
  const loadMessagingDirectory = useCallback(async () => {
    setLoadingDirectory(true)
    try {
      const { data, error } = await supabase.rpc('get_messaging_directory')
      if (error) throw error
      setMessagingUsers(data || [])
    } catch (err: any) {
      console.error('Failed to load messaging directory:', err)
      toast({
        title: '載入通訊錄失敗',
        description: err.message,
        status: 'error',
        duration: 3000,
      })
    } finally {
      setLoadingDirectory(false)
    }
  }, [toast])

  useEffect(() => {
    if (showAddForm && inputMode === 'select') {
      loadMessagingDirectory()
    }
  }, [showAddForm, inputMode, loadMessagingDirectory])

  // Filter directory entries by selected platform
  const filteredDirectoryUsers = messagingUsers.filter((u) => {
    if (newPlatform === 'line') return !!u.line_user_id
    if (newPlatform === 'telegram') return !!u.telegram_chat_id
    return false
  })

  // Handle selecting a user from the directory dropdown
  const handleDirectorySelect = (selectedValue: string) => {
    if (!selectedValue) {
      setNewTargetId('')
      setNewTargetName('')
      return
    }
    const user = messagingUsers.find((u) => {
      if (newPlatform === 'line') return u.line_user_id === selectedValue
      if (newPlatform === 'telegram') return String(u.telegram_chat_id) === selectedValue
      return false
    })
    if (user) {
      setNewTargetId(selectedValue)
      // Auto-fill display name with email prefix (before @)
      const emailPrefix = user.email?.split('@')[0] || ''
      setNewTargetName(emailPrefix)
    }
  }

  // Toggle target selection (for forward mode)
  const toggleTarget = (id: string) => {
    setSelectedTargets((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  // Toggle target's quick-list membership (for manage mode)
  const handleToggleList = async (targetId: string, currentDefault: boolean) => {
    try {
      const updated = await toggleForwardList(targetId, userId, !currentDefault)
      if (updated) {
        setTargets((prev) =>
          prev.map((t) =>
            t.id === targetId ? { ...t, is_default: !currentDefault } : t
          )
        )
        toast({
          title: !currentDefault ? '已加入轉發清單' : '已從轉發清單移除',
          status: 'success',
          duration: 2000,
        })
      }
    } catch (err: any) {
      toast({
        title: '更新失敗',
        description: err.message,
        status: 'error',
        duration: 3000,
      })
    }
  }

  // Add new target
  const handleAddTarget = async () => {
    if (!newTargetId.trim() || !newTargetName.trim()) {
      toast({ title: '請填寫完整資訊', status: 'warning', duration: 2000 })
      return
    }

    try {
      const result = await addForwardTarget(
        userId,
        newPlatform,
        newTargetId.trim(),
        newTargetName.trim(),
        newTargetType,
      )
      if (result) {
        setTargets((prev) => [...prev, result])
        setSelectedTargets((prev) => new Set([...prev, result.id]))
      }
      // Reset form
      setNewTargetId('')
      setNewTargetName('')
      setShowAddForm(false)
      toast({ title: '新增成功', status: 'success', duration: 2000 })
    } catch (err: any) {
      toast({ title: '新增失敗', description: err.message, status: 'error', duration: 3000 })
    }
  }

  // Delete target
  const handleDeleteTarget = async (targetId: string) => {
    try {
      await deleteForwardTarget(targetId, userId)
      setTargets((prev) => prev.filter((t) => t.id !== targetId))
      setSelectedTargets((prev) => {
        const next = new Set(prev)
        next.delete(targetId)
        return next
      })
      toast({ title: '已刪除', status: 'info', duration: 2000 })
    } catch (err: any) {
      toast({ title: '刪除失敗', description: err.message, status: 'error', duration: 3000 })
    }
  }

  // Forward stocks (forward mode)
  const handleForward = async () => {
    if (selectedTargets.size === 0) {
      toast({ title: '請選擇至少一個轉發目標', status: 'warning', duration: 2000 })
      return
    }

    setForwarding(true)
    try {
      const targetList = targets
        .filter((t) => selectedTargets.has(t.id))
        .map((t) => ({
          forward_target_id: t.id,
          platform: t.platform,
          target_id: t.target_id,
          target_name: t.target_name,
        }))

      const resp = await forwardStocks(userId, stocks, targetList)

      if (resp.success) {
        toast({
          title: '轉發完成',
          description: `成功 ${resp.sent_count} 個，失敗 ${resp.failed_count} 個`,
          status: resp.failed_count > 0 ? 'warning' : 'success',
          duration: 4000,
        })
        onClose()
      } else {
        const failDetails = resp.results
          ?.filter((r) => !r.success)
          .map((r) => `${r.target_name}(${r.platform}): ${r.error}`)
          .join('; ')
        toast({
          title: '轉發失敗',
          description: failDetails || '所有目標都發送失敗',
          status: 'error',
          duration: 6000,
          isClosable: true,
        })
      }
    } catch (err: any) {
      toast({ title: '轉發錯誤', description: err.message, status: 'error', duration: 4000 })
    } finally {
      setForwarding(false)
    }
  }

  const quickListCount = targets.filter((t) => t.is_default).length

  // ─── Render target row for forward mode ───
  const renderForwardRow = (target: ForwardTarget) => {
    const config = PLATFORM_CONFIG[target.platform as keyof typeof PLATFORM_CONFIG]
    return (
      <Flex
        key={target.id}
        p={3}
        bg={selectedTargets.has(target.id) ? 'blue.50' : 'white'}
        rounded="xl"
        border="1px solid"
        borderColor={selectedTargets.has(target.id) ? 'blue.300' : 'gray.200'}
        align="center"
        cursor="pointer"
        onClick={() => toggleTarget(target.id)}
        transition="all 0.15s"
        _hover={{ borderColor: 'blue.300' }}
      >
        <Checkbox
          isChecked={selectedTargets.has(target.id)}
          onChange={() => toggleTarget(target.id)}
          colorScheme="blue"
          mr={3}
          onClick={(e) => e.stopPropagation()}
        />
        <VStack align="start" spacing={0} flex={1}>
          <HStack spacing={2}>
            <Text fontWeight="bold" fontSize="sm">
              {config?.emoji} {target.target_name}
            </Text>
            <Badge colorScheme={config?.color || 'gray'} size="sm" rounded="full">
              {config?.label || target.platform}
            </Badge>
            <Badge colorScheme="gray" variant="outline" size="sm" rounded="full">
              {target.target_type === 'group' ? '群組' : '個人'}
            </Badge>
            {target.is_default && (
              <Badge colorScheme="yellow" size="sm" rounded="full">
                清單
              </Badge>
            )}
          </HStack>
          <Text fontSize="xs" color="gray.500">
            ID: {target.target_id.substring(0, 12)}...
          </Text>
        </VStack>
        <Button
          size="xs"
          variant="ghost"
          colorScheme="red"
          onClick={(e) => {
            e.stopPropagation()
            handleDeleteTarget(target.id)
          }}
        >
          刪除
        </Button>
      </Flex>
    )
  }

  // ─── Render target row for manage mode ───
  const renderManageRow = (target: ForwardTarget) => {
    const config = PLATFORM_CONFIG[target.platform as keyof typeof PLATFORM_CONFIG]
    return (
      <Flex
        key={target.id}
        p={3}
        bg={target.is_default ? 'green.50' : 'white'}
        rounded="xl"
        border="1px solid"
        borderColor={target.is_default ? 'green.300' : 'gray.200'}
        align="center"
        transition="all 0.15s"
      >
        <VStack align="start" spacing={0} flex={1}>
          <HStack spacing={2}>
            <Text fontWeight="bold" fontSize="sm">
              {config?.emoji} {target.target_name}
            </Text>
            <Badge colorScheme={config?.color || 'gray'} size="sm" rounded="full">
              {config?.label || target.platform}
            </Badge>
            <Badge colorScheme="gray" variant="outline" size="sm" rounded="full">
              {target.target_type === 'group' ? '群組' : '個人'}
            </Badge>
          </HStack>
          <Text fontSize="xs" color="gray.500">
            ID: {target.target_id.substring(0, 12)}...
          </Text>
        </VStack>

        <HStack spacing={2}>
          <Tooltip label={target.is_default ? '從轉發清單移除' : '加入轉發清單'}>
            <Box>
              <Switch
                colorScheme="green"
                isChecked={target.is_default}
                onChange={() => handleToggleList(target.id, target.is_default)}
              />
            </Box>
          </Tooltip>
          <Tooltip label="刪除目標">
            <IconButton
              aria-label="刪除"
              icon={<DeleteIcon />}
              size="xs"
              variant="ghost"
              colorScheme="red"
              onClick={() => handleDeleteTarget(target.id)}
            />
          </Tooltip>
        </HStack>
      </Flex>
    )
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" isCentered>
      <ModalOverlay bg="blackAlpha.400" backdropFilter="blur(4px)" />
      <ModalContent rounded="2xl" mx={4}>
        <ModalHeader>
          <HStack spacing={2}>
            <Text>
              {mode === 'forward' ? '📨 轉發股票資訊' : '📋 編輯轉發清單'}
            </Text>
            {mode === 'forward' && (
              <Badge colorScheme="blue" rounded="full" px={2}>
                {stocks.length} 檔
              </Badge>
            )}
            {mode === 'manage' && (
              <Badge colorScheme="green" rounded="full" px={2}>
                清單 {quickListCount} 個
              </Badge>
            )}
          </HStack>
        </ModalHeader>
        <ModalCloseButton />

        <ModalBody>
          {/* Mode switcher tabs */}
          <HStack spacing={2} mb={4}>
            <Button
              size="sm"
              rounded="lg"
              variant={mode === 'forward' ? 'solid' : 'outline'}
              colorScheme="blue"
              onClick={() => setMode('forward')}
            >
              選擇轉發目標
            </Button>
            <Button
              size="sm"
              rounded="lg"
              variant={mode === 'manage' ? 'solid' : 'outline'}
              colorScheme="green"
              onClick={() => setMode('manage')}
            >
              編輯轉發清單
            </Button>
          </HStack>

          {mode === 'forward' && (
            <>
              {/* Stock summary */}
              <Box bg="gray.50" p={3} rounded="xl" mb={4}>
                <Text fontSize="sm" color="gray.600" mb={1}>
                  轉發內容：
                </Text>
                <Flex wrap="wrap" gap={2}>
                  {stocks.slice(0, 10).map((s) => (
                    <Badge key={s.ticker} colorScheme="blue" variant="subtle" rounded="md">
                      {s.name}({s.ticker})
                    </Badge>
                  ))}
                  {stocks.length > 10 && (
                    <Badge colorScheme="gray" variant="subtle" rounded="md">
                      +{stocks.length - 10} 檔
                    </Badge>
                  )}
                </Flex>
              </Box>

              <Divider mb={4} />

              <Text fontWeight="bold" mb={3}>
                選擇轉發目標
              </Text>

              {loading ? (
                <Flex justify="center" py={6}>
                  <Spinner color="blue.500" />
                </Flex>
              ) : targets.length === 0 ? (
                <Box textAlign="center" py={6}>
                  <Text color="gray.500" mb={2}>
                    尚未設定轉發目標
                  </Text>
                  <Text fontSize="sm" color="gray.400">
                    點擊「編輯轉發清單」來添加 LINE 或 Telegram 聯絡人
                  </Text>
                </Box>
              ) : (
                <VStack spacing={2} align="stretch" mb={4}>
                  {targets.map(renderForwardRow)}
                </VStack>
              )}
            </>
          )}

          {mode === 'manage' && (
            <>
              {/* Manage mode explanation */}
              <Box bg="green.50" p={3} rounded="xl" mb={4}>
                <Text fontSize="sm" color="green.700">
                  開啟開關將目標加入「轉發清單」。在解析結果頁面點擊「轉發」時，系統會自動發送至清單中的所有目標。
                </Text>
              </Box>

              {loading ? (
                <Flex justify="center" py={6}>
                  <Spinner color="green.500" />
                </Flex>
              ) : targets.length === 0 ? (
                <Box textAlign="center" py={6}>
                  <Text color="gray.500" mb={2}>
                    尚未設定轉發目標
                  </Text>
                  <Text fontSize="sm" color="gray.400">
                    點擊下方「新增轉發目標」來添加 LINE 或 Telegram 聯絡人
                  </Text>
                </Box>
              ) : (
                <VStack spacing={2} align="stretch" mb={4}>
                  {targets.map(renderManageRow)}
                </VStack>
              )}
            </>
          )}

          {/* Add target form — shown in both modes */}
          {showAddForm ? (
            <Box bg="gray.50" p={4} rounded="xl" mt={2}>
              <Text fontWeight="bold" fontSize="sm" mb={3}>
                新增轉發目標
              </Text>
              <VStack spacing={3}>
                <HStack spacing={3} w="full">
                  <Select
                    size="sm"
                    rounded="lg"
                    value={newPlatform}
                    onChange={(e) => {
                      setNewPlatform(e.target.value as 'line' | 'telegram')
                      // Reset selection when platform changes
                      setNewTargetId('')
                      setNewTargetName('')
                    }}
                    w="40%"
                  >
                    <option value="telegram">Telegram</option>
                    <option value="line">LINE</option>
                  </Select>
                  <Select
                    size="sm"
                    rounded="lg"
                    value={newTargetType}
                    onChange={(e) =>
                      setNewTargetType(e.target.value as 'user' | 'group')
                    }
                    w="35%"
                  >
                    <option value="user">個人</option>
                    <option value="group">群組</option>
                  </Select>
                </HStack>
                <Input
                  size="sm"
                  rounded="lg"
                  placeholder="顯示名稱（如：小明、投資群）"
                  value={newTargetName}
                  onChange={(e) => setNewTargetName(e.target.value)}
                />

                {/* Input mode toggle: manual vs select from directory */}
                <Box w="full">
                  <HStack spacing={1} mb={2}>
                    <Text fontSize="xs" color="gray.500">
                      ID 輸入方式：
                    </Text>
                    <ButtonGroup size="xs" isAttached variant="outline">
                      <Button
                        rounded="md"
                        colorScheme={inputMode === 'manual' ? 'blue' : 'gray'}
                        variant={inputMode === 'manual' ? 'solid' : 'outline'}
                        onClick={() => setInputMode('manual')}
                      >
                        手動輸入
                      </Button>
                      <Button
                        rounded="md"
                        colorScheme={inputMode === 'select' ? 'blue' : 'gray'}
                        variant={inputMode === 'select' ? 'solid' : 'outline'}
                        onClick={() => setInputMode('select')}
                      >
                        從通訊錄選擇
                      </Button>
                    </ButtonGroup>
                  </HStack>

                  {inputMode === 'manual' ? (
                    <Input
                      size="sm"
                      rounded="lg"
                      placeholder={
                        newPlatform === 'telegram'
                          ? 'Telegram Chat ID（如：123456789）'
                          : 'LINE User/Group ID'
                      }
                      value={newTargetId}
                      onChange={(e) => setNewTargetId(e.target.value)}
                    />
                  ) : loadingDirectory ? (
                    <Flex justify="center" py={2}>
                      <Spinner size="sm" color="blue.400" />
                      <Text fontSize="xs" color="gray.500" ml={2}>
                        載入通訊錄...
                      </Text>
                    </Flex>
                  ) : filteredDirectoryUsers.length === 0 ? (
                    <Box py={2}>
                      <Text fontSize="xs" color="orange.500">
                        目前沒有已註冊的{newPlatform === 'line' ? ' LINE ' : ' Telegram '}用戶，請使用手動輸入。
                      </Text>
                    </Box>
                  ) : (
                    <Select
                      size="sm"
                      rounded="lg"
                      placeholder="— 請選擇 —"
                      value={newTargetId}
                      onChange={(e) => handleDirectorySelect(e.target.value)}
                    >
                      {filteredDirectoryUsers.map((u) => {
                        const id =
                          newPlatform === 'line'
                            ? u.line_user_id!
                            : String(u.telegram_chat_id!)
                        const dateStr = new Date(u.created_at).toLocaleDateString('zh-TW')
                        return (
                          <option key={u.user_id} value={id}>
                            {u.email} — ID: {id.substring(0, 16)}
                            {id.length > 16 ? '...' : ''} （{dateStr}）
                          </option>
                        )
                      })}
                    </Select>
                  )}
                </Box>

                <HStack spacing={2} w="full" justify="end">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setShowAddForm(false)
                      setInputMode('manual')
                      setNewTargetId('')
                      setNewTargetName('')
                    }}
                    rounded="lg"
                  >
                    取消
                  </Button>
                  <Button
                    size="sm"
                    colorScheme="blue"
                    onClick={handleAddTarget}
                    rounded="lg"
                  >
                    確認新增
                  </Button>
                </HStack>
              </VStack>
            </Box>
          ) : (
            <Button
              size="sm"
              variant="outline"
              colorScheme="blue"
              onClick={() => setShowAddForm(true)}
              rounded="lg"
              w="full"
            >
              + 新增轉發目標
            </Button>
          )}
        </ModalBody>

        <ModalFooter>
          <HStack spacing={3}>
            <Button variant="ghost" onClick={onClose} rounded="lg">
              {mode === 'manage' ? '完成' : '取消'}
            </Button>
            {mode === 'forward' && (
              <Button
                colorScheme="blue"
                onClick={handleForward}
                isLoading={forwarding}
                loadingText="轉發中..."
                rounded="xl"
                px={6}
                isDisabled={selectedTargets.size === 0}
                bgGradient="linear(to-r, blue.400, blue.600)"
                _hover={{ bgGradient: 'linear(to-r, blue.500, blue.700)' }}
              >
                轉發至 {selectedTargets.size} 個目標
              </Button>
            )}
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
