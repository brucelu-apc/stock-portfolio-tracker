/**
 * StockForwardModal — Modal for forwarding selected stocks to LINE/Telegram targets.
 *
 * Flow:
 *  1. User clicks "轉發" button in ParsePreview
 *  2. Modal opens with list of forward targets
 *  3. User selects targets (checkboxes)
 *  4. Click "轉發" to send formatted messages to each target
 *  5. Results shown with success/failure status
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
} from '@chakra-ui/react'
import {
  type ParsedStock,
  type ForwardTarget,
  getForwardTargets,
  addForwardTarget,
  deleteForwardTarget,
  forwardStocks,
} from '../../services/backend'

interface StockForwardModalProps {
  isOpen: boolean
  onClose: () => void
  stocks: ParsedStock[]
  userId: string
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
}: StockForwardModalProps) => {
  const toast = useToast()
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

  // Load forward targets
  const loadTargets = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    try {
      const data = await getForwardTargets(userId)
      setTargets(data)
      // Auto-select defaults
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

  // Toggle target selection
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

  // Forward stocks
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
        toast({
          title: '轉發失敗',
          description: '所有目標都發送失敗',
          status: 'error',
          duration: 4000,
        })
      }
    } catch (err: any) {
      toast({ title: '轉發錯誤', description: err.message, status: 'error', duration: 4000 })
    } finally {
      setForwarding(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" isCentered>
      <ModalOverlay bg="blackAlpha.400" backdropFilter="blur(4px)" />
      <ModalContent rounded="2xl" mx={4}>
        <ModalHeader>
          <HStack spacing={2}>
            <Text>📨 轉發股票資訊</Text>
            <Badge colorScheme="blue" rounded="full" px={2}>
              {stocks.length} 檔
            </Badge>
          </HStack>
        </ModalHeader>
        <ModalCloseButton />

        <ModalBody>
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

          {/* Target list */}
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
                點擊下方「新增目標」來添加 LINE 或 Telegram 聯絡人
              </Text>
            </Box>
          ) : (
            <VStack spacing={2} align="stretch" mb={4}>
              {targets.map((target) => {
                const config = PLATFORM_CONFIG[target.platform as keyof typeof PLATFORM_CONFIG]
                return (
                  <Flex
                    key={target.id}
                    p={3}
                    bg={selectedTargets.has(target.id) ? 'blue.50' : 'white'}
                    rounded="xl"
                    border="1px solid"
                    borderColor={
                      selectedTargets.has(target.id) ? 'blue.300' : 'gray.200'
                    }
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
                        <Badge
                          colorScheme={config?.color || 'gray'}
                          size="sm"
                          rounded="full"
                        >
                          {config?.label || target.platform}
                        </Badge>
                        <Badge
                          colorScheme="gray"
                          variant="outline"
                          size="sm"
                          rounded="full"
                        >
                          {target.target_type === 'group' ? '群組' : '個人'}
                        </Badge>
                        {target.is_default && (
                          <Badge colorScheme="yellow" size="sm" rounded="full">
                            預設
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
              })}
            </VStack>
          )}

          {/* Add target form */}
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
                    onChange={(e) =>
                      setNewPlatform(e.target.value as 'line' | 'telegram')
                    }
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
                <HStack spacing={2} w="full" justify="end">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowAddForm(false)}
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
              取消
            </Button>
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
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
