/**
 * ParsePreview — Displays parsed notification results with stock selection.
 *
 * Features:
 *  - Checkbox selection for individual stocks
 *  - Color-coded message types (recommendation, buy, sell, etc.)
 *  - Import selected stocks to Supabase
 *  - Forward selected stocks to LINE/Telegram (Phase 4)
 */
import { useState, useMemo } from 'react'
import {
  Box,
  VStack,
  HStack,
  Text,
  Checkbox,
  Button,
  Badge,
  Divider,
  Flex,
  SimpleGrid,
  useToast,
  Tooltip,
  Tag,
  TagLabel,
} from '@chakra-ui/react'
import { useDisclosure } from '@chakra-ui/react'
import { type ParseResponse, type ParsedStock, importNotification, quickForwardStocks } from '../../services/backend'
import { StockForwardModal } from './StockForwardModal'

type ForwardModalMode = 'forward' | 'manage'

interface ParsePreviewProps {
  result: ParseResponse
  userId: string
  rawText: string
  onImportDone?: () => void
}

// Message type display config
const MSG_TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  market_analysis: { label: '大盤解析', color: 'purple' },
  recommendation: { label: '個股推薦', color: 'blue' },
  institutional: { label: '法人鎖碼', color: 'orange' },
  buy_signal: { label: '買進訊號', color: 'green' },
  hold: { label: '續抱', color: 'teal' },
  sell_signal: { label: '賣出訊號', color: 'red' },
  greeting: { label: '問候', color: 'gray' },
}

export const ParsePreview = ({ result, userId, rawText, onImportDone }: ParsePreviewProps) => {
  const toast = useToast()
  const [importing, setImporting] = useState(false)
  const [quickForwarding, setQuickForwarding] = useState(false)
  const [forwardModalMode, setForwardModalMode] = useState<ForwardModalMode>('forward')
  const forwardModal = useDisclosure()

  // Deduplicate stocks across all messages
  const allStocks = useMemo(() => {
    const map = new Map<string, ParsedStock & { messageType: string }>()
    result.messages.forEach((msg) => {
      msg.stocks.forEach((stock) => {
        // Keep the most informative version (one with more target prices)
        const existing = map.get(stock.ticker)
        if (
          !existing ||
          (stock.min_target_low && !existing.min_target_low) ||
          (stock.defense_price && !existing.defense_price)
        ) {
          map.set(stock.ticker, { ...stock, messageType: msg.message_type })
        }
      })
    })
    return Array.from(map.values())
  }, [result])

  // Selection state
  const [selected, setSelected] = useState<Set<string>>(
    new Set(allStocks.map((s) => s.ticker))
  )

  const toggleStock = (ticker: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(ticker)) {
        next.delete(ticker)
      } else {
        next.add(ticker)
      }
      return next
    })
  }

  const selectAll = () => setSelected(new Set(allStocks.map((s) => s.ticker)))
  const selectNone = () => setSelected(new Set())

  const handleImport = async () => {
    if (selected.size === 0) {
      toast({ title: '請至少選擇一檔股票', status: 'warning', duration: 3000 })
      return
    }

    setImporting(true)
    try {
      const resp = await importNotification(
        rawText,
        userId,
        Array.from(selected),
        'dashboard'
      )

      if (resp.success) {
        toast({
          title: `匯入成功`,
          description: `已匯入 ${resp.imported_count} 檔股票`,
          status: 'success',
          duration: 4000,
        })
        onImportDone?.()
      }
    } catch (err: any) {
      toast({
        title: '匯入失敗',
        description: err.message,
        status: 'error',
        duration: 5000,
      })
    } finally {
      setImporting(false)
    }
  }

  // Quick forward: send directly to pre-defined forward list
  const handleQuickForward = async () => {
    if (selected.size === 0) {
      toast({ title: '請至少選擇一檔股票', status: 'warning', duration: 3000 })
      return
    }

    setQuickForwarding(true)
    try {
      const selectedStocks = allStocks.filter((s) => selected.has(s.ticker))
      const resp = await quickForwardStocks(userId, selectedStocks)

      if (resp.total_targets === 0) {
        // No targets in quick list — prompt to set up
        toast({
          title: '尚未設定轉發清單',
          description: '請先點擊「編輯轉發清單」設定快速轉發目標',
          status: 'warning',
          duration: 4000,
        })
        // Open modal in manage mode
        setForwardModalMode('manage')
        forwardModal.onOpen()
      } else if (resp.success) {
        toast({
          title: '轉發完成',
          description: `成功 ${resp.sent_count} 個，失敗 ${resp.failed_count} 個`,
          status: resp.failed_count > 0 ? 'warning' : 'success',
          duration: 4000,
        })
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
      setQuickForwarding(false)
    }
  }

  // Open forward modal in manage mode
  const handleOpenManage = () => {
    setForwardModalMode('manage')
    forwardModal.onOpen()
  }

  return (
    <Box bg="white" p={{ base: 4, md: 8 }} rounded="3xl" shadow="2xl" border="1px" borderColor="gray.50">
      {/* Header */}
      <Flex justify="space-between" align="center" mb={6}>
        <HStack spacing={3}>
          <Text fontSize="lg" fontWeight="extrabold" color="ui.navy">
            解析結果
          </Text>
          <Badge colorScheme="green" rounded="full" px={3}>
            {allStocks.length} 檔股票
          </Badge>
          {result.dates_found.length > 0 && (
            <Text fontSize="xs" color="ui.slate">
              {result.dates_found.join(' ~ ')}
            </Text>
          )}
        </HStack>
        <HStack spacing={2}>
          <Button size="xs" variant="ghost" onClick={selectAll} rounded="lg">
            全選
          </Button>
          <Button size="xs" variant="ghost" onClick={selectNone} rounded="lg">
            取消全選
          </Button>
        </HStack>
      </Flex>

      {/* Stock list */}
      <VStack spacing={3} align="stretch" mb={6}>
        {allStocks.map((stock) => {
          const isChecked = selected.has(stock.ticker)
          const typeConfig = MSG_TYPE_CONFIG[stock.messageType] || MSG_TYPE_CONFIG.greeting

          return (
            <Box
              key={stock.ticker}
              p={4}
              bg={isChecked ? 'blue.50' : 'gray.50'}
              rounded="2xl"
              border="2px solid"
              borderColor={isChecked ? 'brand.500' : 'transparent'}
              cursor="pointer"
              onClick={() => toggleStock(stock.ticker)}
              transition="all 0.2s"
              _hover={{ shadow: 'md' }}
            >
              <Flex justify="space-between" align="start">
                <HStack spacing={3} align="start">
                  <Checkbox
                    isChecked={isChecked}
                    onChange={() => toggleStock(stock.ticker)}
                    colorScheme="blue"
                    mt={1}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <VStack align="start" spacing={1}>
                    <HStack spacing={2}>
                      <Text fontWeight="extrabold" color="ui.navy">
                        {stock.name}({stock.ticker})
                      </Text>
                      <Tag size="sm" colorScheme={typeConfig.color} rounded="full">
                        <TagLabel fontSize="xs">{typeConfig.label}</TagLabel>
                      </Tag>
                    </HStack>

                    {/* Price targets summary */}
                    <SimpleGrid columns={{ base: 1, md: 3 }} spacing={3}>
                      {stock.defense_price && (
                        <Tooltip label="跌破此價位需離場">
                          <HStack>
                            <Text fontSize="xs" color="red.500" fontWeight="bold">
                              防守
                            </Text>
                            <Text fontSize="sm" fontWeight="bold" color="red.600">
                              {stock.defense_price} 元
                            </Text>
                          </HStack>
                        </Tooltip>
                      )}
                      {stock.min_target_low && (
                        <Tooltip label="最小預期漲幅區間">
                          <HStack>
                            <Text fontSize="xs" color="green.500" fontWeight="bold">
                              最小漲幅
                            </Text>
                            <Text fontSize="sm" fontWeight="bold" color="green.600">
                              {stock.min_target_low}~{stock.min_target_high} 元
                            </Text>
                          </HStack>
                        </Tooltip>
                      )}
                      {stock.reasonable_target_low && (
                        <Tooltip label="合理預期漲幅區間">
                          <HStack>
                            <Text fontSize="xs" color="orange.500" fontWeight="bold">
                              合理漲幅
                            </Text>
                            <Text fontSize="sm" fontWeight="bold" color="orange.600">
                              {stock.reasonable_target_low}~{stock.reasonable_target_high} 元
                            </Text>
                          </HStack>
                        </Tooltip>
                      )}
                    </SimpleGrid>

                    {/* Entry price */}
                    {stock.entry_price && (
                      <Text fontSize="xs" color="blue.600">
                        建議買進價：{stock.entry_price} 元以下
                      </Text>
                    )}

                    {/* Strategy notes */}
                    {stock.strategy_notes && stock.strategy_notes !== '法人鎖碼股' && (
                      <Text fontSize="xs" color="ui.slate" noOfLines={2}>
                        {stock.strategy_notes}
                      </Text>
                    )}
                  </VStack>
                </HStack>
              </Flex>
            </Box>
          )
        })}
      </VStack>

      <Divider mb={4} />

      {/* Action buttons */}
      <Flex justify="space-between" align="center" flexWrap="wrap" gap={2}>
        <Text fontSize="sm" color="ui.slate">
          已選擇 {selected.size} / {allStocks.length} 檔
        </Text>
        <HStack spacing={3} flexWrap="wrap">
          <Button
            variant="outline"
            colorScheme="blue"
            onClick={handleQuickForward}
            isLoading={quickForwarding}
            loadingText="轉發中..."
            rounded="xl"
            px={6}
            isDisabled={selected.size === 0}
          >
            📨 轉發 ({selected.size})
          </Button>
          <Button
            variant="outline"
            colorScheme="green"
            onClick={handleOpenManage}
            rounded="xl"
            px={6}
          >
            📋 編輯轉發清單
          </Button>
          <Button
            colorScheme="blue"
            onClick={handleImport}
            isLoading={importing}
            loadingText="匯入中..."
            rounded="xl"
            px={6}
            bgGradient="linear(to-r, brand.500, brand.600)"
            _hover={{ bgGradient: "linear(to-r, brand.600, brand.900)" }}
            isDisabled={selected.size === 0}
          >
            匯入選取項目 ({selected.size})
          </Button>
        </HStack>
      </Flex>

      {/* Forward Modal (supports both forward and manage modes) */}
      <StockForwardModal
        isOpen={forwardModal.isOpen}
        onClose={forwardModal.onClose}
        stocks={allStocks.filter((s) => selected.has(s.ticker))}
        userId={userId}
        initialMode={forwardModalMode}
      />
    </Box>
  )
}
