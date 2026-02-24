/**
 * ParsePreview — Displays parsed notification results with FIXED output format.
 *
 * Every stock shows 6 fields (待定 for missing values):
 *   1. 股票名稱(股票代號)
 *   2. 操作訊號
 *   3. 防守價
 *   4. 最小漲幅
 *   5. 合理漲幅
 *   6. 操作策略
 *
 * All fields are editable inline before import.
 */
import { useState, useCallback } from 'react'
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
  useToast,
  Tag,
  TagLabel,
  Input,
  IconButton,
  Tooltip,
} from '@chakra-ui/react'
import { CheckIcon, CloseIcon, EditIcon } from '@chakra-ui/icons'
import { useDisclosure } from '@chakra-ui/react'
import {
  type ParseResponse,
  type FormattedStockOutput,
  type EditedStock,
  importNotification,
  quickForwardStocks,
} from '../../services/backend'
import { StockForwardModal } from './StockForwardModal'

type ForwardModalMode = 'forward' | 'manage'

const PENDING = '待定'

interface ParsePreviewProps {
  result: ParseResponse
  userId: string
  rawText: string
  onImportDone?: () => void
}

// Action signal → color mapping
const SIGNAL_COLOR: Record<string, string> = {
  '買進建立': 'green',
  '賣出': 'red',
  '續抱': 'teal',
  '法人鎖碼股': 'orange',
}

// The 6 fixed display fields (key → label)
const DISPLAY_FIELDS: Array<{
  key: keyof FormattedStockOutput
  label: string
  color: string
}> = [
  { key: 'defense_price_display', label: '防守價', color: 'red' },
  { key: 'min_target_display', label: '最小漲幅', color: 'green' },
  { key: 'reasonable_target_display', label: '合理漲幅', color: 'orange' },
  { key: 'strategy_display', label: '操作策略', color: 'gray' },
]

export const ParsePreview = ({ result, userId, rawText, onImportDone }: ParsePreviewProps) => {
  const toast = useToast()
  const [importing, setImporting] = useState(false)
  const [quickForwarding, setQuickForwarding] = useState(false)
  const [forwardModalMode, setForwardModalMode] = useState<ForwardModalMode>('forward')
  const forwardModal = useDisclosure()

  // Use formatted_output from backend (deduplicated, fixed format)
  const [stocks, setStocks] = useState<FormattedStockOutput[]>(
    () => result.formatted_output || []
  )

  // Selection state
  const [selected, setSelected] = useState<Set<string>>(
    new Set(stocks.map((s) => s.ticker))
  )

  // Editing state: which stock+field is being edited
  const [editingCell, setEditingCell] = useState<{
    ticker: string
    field: string
  } | null>(null)
  const [editValue, setEditValue] = useState('')

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

  const selectAll = () => setSelected(new Set(stocks.map((s) => s.ticker)))
  const selectNone = () => setSelected(new Set())

  // ── Inline editing ──

  const startEdit = useCallback((ticker: string, field: string, currentValue: string) => {
    setEditingCell({ ticker, field })
    setEditValue(currentValue === PENDING ? '' : currentValue)
  }, [])

  const cancelEdit = useCallback(() => {
    setEditingCell(null)
    setEditValue('')
  }, [])

  const saveEdit = useCallback(() => {
    if (!editingCell) return

    setStocks((prev) =>
      prev.map((stock) => {
        if (stock.ticker !== editingCell.ticker) return stock
        return {
          ...stock,
          [editingCell.field]: editValue.trim() || PENDING,
        }
      })
    )
    setEditingCell(null)
    setEditValue('')
  }, [editingCell, editValue])

  const handleEditKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        saveEdit()
      } else if (e.key === 'Escape') {
        cancelEdit()
      }
    },
    [saveEdit, cancelEdit]
  )

  // ── Import with edited data ──

  const handleImport = async () => {
    if (selected.size === 0) {
      toast({ title: '請至少選擇一檔股票', status: 'warning', duration: 3000 })
      return
    }

    setImporting(true)
    try {
      // Build edited_stocks from current (possibly edited) state
      const editedStocks: EditedStock[] = stocks
        .filter((s) => selected.has(s.ticker))
        .map((s) => ({
          ticker: s.ticker,
          name: s.name,
          display_name: s.display_name,
          action_signal: s.action_signal,
          defense_price_display: s.defense_price_display,
          min_target_display: s.min_target_display,
          reasonable_target_display: s.reasonable_target_display,
          strategy_display: s.strategy_display,
          defense_price: s.defense_price,
          min_target_low: s.min_target_low,
          min_target_high: s.min_target_high,
          reasonable_target_low: s.reasonable_target_low,
          reasonable_target_high: s.reasonable_target_high,
          entry_price: s.entry_price,
          strategy_notes: s.strategy_display !== PENDING ? s.strategy_display : '',
          action_type: s.action_type,
        }))

      const resp = await importNotification(
        rawText,
        userId,
        Array.from(selected),
        'dashboard',
        editedStocks
      )

      if (resp.success) {
        toast({
          title: '匯入成功',
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

  // ── Quick forward ──

  const handleQuickForward = async () => {
    if (selected.size === 0) {
      toast({ title: '請至少選擇一檔股票', status: 'warning', duration: 3000 })
      return
    }

    setQuickForwarding(true)
    try {
      // Convert FormattedStockOutput to ParsedStock shape for forward API
      const selectedStocks = stocks
        .filter((s) => selected.has(s.ticker))
        .map((s) => ({
          ticker: s.ticker,
          name: s.name,
          defense_price: s.defense_price,
          min_target_low: s.min_target_low,
          min_target_high: s.min_target_high,
          reasonable_target_low: s.reasonable_target_low,
          reasonable_target_high: s.reasonable_target_high,
          entry_price: s.entry_price,
          strategy_notes: s.strategy_display !== PENDING ? s.strategy_display : '',
          action_type: s.action_type,
          display_name: s.display_name,
          action_signal: s.action_signal,
          defense_price_display: s.defense_price_display,
          min_target_display: s.min_target_display,
          reasonable_target_display: s.reasonable_target_display,
          strategy_display: s.strategy_display,
        }))

      const resp = await quickForwardStocks(userId, selectedStocks)

      if (resp.total_targets === 0) {
        toast({
          title: '尚未設定轉發清單',
          description: '請先點擊「編輯轉發清單」設定快速轉發目標',
          status: 'warning',
          duration: 4000,
        })
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

  const handleOpenManage = () => {
    setForwardModalMode('manage')
    forwardModal.onOpen()
  }

  // ── Render editable cell ──

  const renderEditableField = (
    stock: FormattedStockOutput,
    fieldKey: keyof FormattedStockOutput,
    label: string,
    labelColor: string
  ) => {
    const value = stock[fieldKey] as string
    const isPending = value === PENDING
    const isEditing =
      editingCell?.ticker === stock.ticker && editingCell?.field === fieldKey

    if (isEditing) {
      return (
        <HStack spacing={1} w="100%">
          <Text fontSize="xs" color={`${labelColor}.500`} fontWeight="bold" minW="56px">
            {label}
          </Text>
          <Input
            size="xs"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleEditKeyDown}
            autoFocus
            placeholder={`輸入${label}`}
            rounded="md"
            flex={1}
          />
          <IconButton
            aria-label="儲存"
            icon={<CheckIcon />}
            size="xs"
            colorScheme="green"
            variant="ghost"
            onClick={saveEdit}
          />
          <IconButton
            aria-label="取消"
            icon={<CloseIcon />}
            size="xs"
            variant="ghost"
            onClick={cancelEdit}
          />
        </HStack>
      )
    }

    return (
      <HStack
        spacing={1}
        cursor="pointer"
        onClick={(e) => {
          e.stopPropagation()
          startEdit(stock.ticker, fieldKey, value)
        }}
        _hover={{ bg: 'blackAlpha.50' }}
        rounded="md"
        px={1}
        py={0.5}
        role="group"
      >
        <Text fontSize="xs" color={`${labelColor}.500`} fontWeight="bold" minW="56px">
          {label}
        </Text>
        <Text
          fontSize="sm"
          fontWeight={isPending ? 'normal' : 'bold'}
          color={isPending ? 'gray.400' : `${labelColor}.600`}
          fontStyle={isPending ? 'italic' : 'normal'}
        >
          {value}
        </Text>
        <EditIcon
          boxSize={3}
          color="gray.300"
          _groupHover={{ color: 'gray.500' }}
          ml="auto"
        />
      </HStack>
    )
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
            {stocks.length} 檔股票
          </Badge>
          {result.dates_found.length > 0 && (
            <Text fontSize="xs" color="ui.slate">
              {result.dates_found.join(' ~ ')}
            </Text>
          )}
        </HStack>
        <HStack spacing={2}>
          <Tooltip label="點擊欄位值可直接編輯">
            <Badge colorScheme="purple" variant="subtle" rounded="full" px={3}>
              可編輯
            </Badge>
          </Tooltip>
          <Button size="xs" variant="ghost" onClick={selectAll} rounded="lg">
            全選
          </Button>
          <Button size="xs" variant="ghost" onClick={selectNone} rounded="lg">
            取消全選
          </Button>
        </HStack>
      </Flex>

      {/* Stock list — fixed format */}
      <VStack spacing={3} align="stretch" mb={6}>
        {stocks.map((stock) => {
          const isChecked = selected.has(stock.ticker)
          const signalColor = SIGNAL_COLOR[stock.action_signal] || 'gray'

          return (
            <Box
              key={stock.ticker}
              p={4}
              bg={isChecked ? 'blue.50' : 'gray.50'}
              rounded="2xl"
              border="2px solid"
              borderColor={isChecked ? 'brand.500' : 'transparent'}
              transition="all 0.2s"
              _hover={{ shadow: 'md' }}
            >
              <Flex justify="space-between" align="start">
                <HStack spacing={3} align="start" flex={1}>
                  <Checkbox
                    isChecked={isChecked}
                    onChange={() => toggleStock(stock.ticker)}
                    colorScheme="blue"
                    mt={1}
                  />
                  <VStack align="start" spacing={2} flex={1}>
                    {/* Row 1: Stock name + action signal */}
                    <HStack spacing={2}>
                      <Text fontWeight="extrabold" color="ui.navy">
                        {stock.display_name}
                      </Text>
                      <Tag size="sm" colorScheme={signalColor} rounded="full">
                        <TagLabel fontSize="xs">{stock.action_signal}</TagLabel>
                      </Tag>
                    </HStack>

                    {/* Row 2+: Fixed fields — always shown, editable */}
                    <VStack align="start" spacing={1} w="100%">
                      {DISPLAY_FIELDS.map((field) => (
                        <Box key={field.key} w="100%">
                          {renderEditableField(
                            stock,
                            field.key,
                            field.label,
                            field.color
                          )}
                        </Box>
                      ))}
                    </VStack>
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
          已選擇 {selected.size} / {stocks.length} 檔
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
            轉發 ({selected.size})
          </Button>
          <Button
            variant="outline"
            colorScheme="green"
            onClick={handleOpenManage}
            rounded="xl"
            px={6}
          >
            編輯轉發清單
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

      {/* Forward Modal */}
      <StockForwardModal
        isOpen={forwardModal.isOpen}
        onClose={forwardModal.onClose}
        stocks={stocks
          .filter((s) => selected.has(s.ticker))
          .map((s) => ({
            ticker: s.ticker,
            name: s.name,
            defense_price: s.defense_price,
            min_target_low: s.min_target_low,
            min_target_high: s.min_target_high,
            reasonable_target_low: s.reasonable_target_low,
            reasonable_target_high: s.reasonable_target_high,
            entry_price: s.entry_price,
            strategy_notes: s.strategy_display !== PENDING ? s.strategy_display : '',
            action_type: s.action_type,
            display_name: s.display_name,
            action_signal: s.action_signal,
            defense_price_display: s.defense_price_display,
            min_target_display: s.min_target_display,
            reasonable_target_display: s.reasonable_target_display,
            strategy_display: s.strategy_display,
          }))}
        userId={userId}
        initialMode={forwardModalMode}
      />
    </Box>
  )
}
