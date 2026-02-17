import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalFooter,
  ModalBody,
  ModalCloseButton,
  Button,
  FormControl,
  FormLabel,
  Input,
  Select,
  VStack,
  HStack,
  useToast,
  Switch,
  Divider,
  Text,
  Box,
} from '@chakra-ui/react'
import { useState, useEffect } from 'react'
import { supabase } from '../../services/supabase'
import { Holding } from '../../utils/calculations'
import type { AggregateEditInfo } from './HoldingsTable'

interface Props {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  holding: Holding | null
  aggregateInfo?: AggregateEditInfo | null  // non-null = aggregate mode
}

export const EditHoldingModal = ({ isOpen, onClose, onSuccess, holding, aggregateInfo }: Props) => {
  const [region, setRegion] = useState('TPE')
  const [ticker, setTicker] = useState('')
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [shares, setShares] = useState('')
  const [date, setDate] = useState('')
  const [strategyMode, setStrategyMode] = useState<'auto' | 'manual'>('auto')
  const [manualTP, setManualTP] = useState('')
  const [manualSL, setManualSL] = useState('')
  const [loading, setLoading] = useState(false)
  const toast = useToast()

  // Is this an aggregate (multi-record) edit?
  const isAggregate = !!aggregateInfo

  useEffect(() => {
    if (holding) {
      setRegion(holding.region)
      setTicker(holding.ticker)
      setName(holding.name || '')
      setDate(holding.buy_date)
      setStrategyMode(holding.strategy_mode || 'auto')
      setManualTP(holding.manual_tp?.toString() || '')
      setManualSL(holding.manual_sl?.toString() || '')

      if (aggregateInfo) {
        // Aggregate mode: show totals
        setShares(aggregateInfo.totalShares.toString())
        setPrice(aggregateInfo.avgCost.toFixed(2))
      } else {
        // Single record mode: show this record's values
        setShares(holding.shares?.toString() || '0')
        setPrice(holding.cost_price?.toString() || '0')
      }
    }
  }, [holding, aggregateInfo])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!holding) return
    setLoading(true)

    try {
      if (isAggregate) {
        // Aggregate mode: only update shared fields (name, strategy)
        // across ALL records with same ticker + user_id
        const { error } = await supabase
          .from('portfolio_holdings')
          .update({
            name: name.trim(),
            strategy_mode: strategyMode,
            manual_tp: manualTP ? parseFloat(manualTP) : null,
            manual_sl: manualSL ? parseFloat(manualSL) : null,
          })
          .eq('ticker', holding.ticker)
          .eq('user_id', holding.user_id)

        if (error) throw error
      } else {
        // Single record mode: update this specific record
        const { error: singleError } = await supabase
          .from('portfolio_holdings')
          .update({
            region,
            ticker: ticker.trim().toUpperCase(),
            name: name.trim(),
            cost_price: parseFloat(price),
            shares: parseFloat(shares),
            buy_date: date,
            strategy_mode: strategyMode,
            manual_tp: manualTP ? parseFloat(manualTP) : null,
            manual_sl: manualSL ? parseFloat(manualSL) : null,
          })
          .eq('id', holding.id)

        if (singleError) throw singleError

        // Also sync strategy to all same-ticker records
        const { error: batchError } = await supabase
          .from('portfolio_holdings')
          .update({
            strategy_mode: strategyMode,
            manual_tp: manualTP ? parseFloat(manualTP) : null,
            manual_sl: manualSL ? parseFloat(manualSL) : null,
          })
          .eq('ticker', holding.ticker)
          .eq('user_id', holding.user_id)

        if (batchError) throw batchError
      }

      toast({ title: '更新成功', status: 'success' })
      onSuccess()
      onClose()
    } catch (error: any) {
      toast({ title: '更新失敗', description: error.message, status: 'error' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          {isAggregate ? `編輯持股總覽 - ${ticker}` : `編輯持股 - ${ticker}`}
        </ModalHeader>
        <ModalCloseButton />
        <form onSubmit={handleSubmit}>
          <ModalBody>
            <VStack spacing={4}>
              {isAggregate && (
                <Box w="full" bg="blue.50" p={3} rounded="md" fontSize="sm" color="blue.700">
                  目前為總覽編輯模式，買入價格/股數/日期請從「買入明細」中編輯個別紀錄。
                </Box>
              )}

              <FormControl isRequired>
                <FormLabel>市場地區</FormLabel>
                <Select
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  isDisabled={isAggregate}
                >
                  <option value="TPE">台股 (TPE)</option>
                  <option value="US">美股 (US)</option>
                </Select>
              </FormControl>

              <FormControl isRequired>
                <FormLabel>股票代碼</FormLabel>
                <Input
                  value={ticker}
                  onChange={(e) => setTicker(e.target.value)}
                  isDisabled={isAggregate}
                />
              </FormControl>

              <FormControl>
                <FormLabel>股票名稱</FormLabel>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </FormControl>

              <HStack w="full">
                <FormControl isRequired>
                  <FormLabel>
                    {isAggregate ? '加權均價 (唯讀)' : '買入價格'}
                  </FormLabel>
                  <Input
                    type="number"
                    step="any"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    isDisabled={isAggregate}
                    bg={isAggregate ? 'gray.100' : undefined}
                  />
                </FormControl>
                <FormControl isRequired>
                  <FormLabel>
                    {isAggregate ? '總股數 (唯讀)' : '股數'}
                  </FormLabel>
                  <Input
                    type="number"
                    step="any"
                    value={shares}
                    onChange={(e) => setShares(e.target.value)}
                    isDisabled={isAggregate}
                    bg={isAggregate ? 'gray.100' : undefined}
                  />
                </FormControl>
              </HStack>

              <FormControl isRequired>
                <FormLabel>
                  {isAggregate ? '最近買入日期 (唯讀)' : '買入日期'}
                </FormLabel>
                <Input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  isDisabled={isAggregate}
                  bg={isAggregate ? 'gray.100' : undefined}
                />
              </FormControl>

              <Divider />

              <FormControl display="flex" alignItems="center">
                <FormLabel mb="0">
                  策略模式: {strategyMode === 'auto' ? '自動移動停利' : '手動設定'}
                </FormLabel>
                <Switch
                  isChecked={strategyMode === 'manual'}
                  onChange={(e) => setStrategyMode(e.target.checked ? 'manual' : 'auto')}
                />
              </FormControl>

              {strategyMode === 'manual' && (
                <HStack w="full">
                  <FormControl>
                    <FormLabel fontSize="sm">手動停利價</FormLabel>
                    <Input
                      type="number"
                      step="any"
                      value={manualTP}
                      onChange={(e) => setManualTP(e.target.value)}
                    />
                  </FormControl>
                  <FormControl>
                    <FormLabel fontSize="sm">手動停損價</FormLabel>
                    <Input
                      type="number"
                      step="any"
                      value={manualSL}
                      onChange={(e) => setManualSL(e.target.value)}
                    />
                  </FormControl>
                </HStack>
              )}
            </VStack>
          </ModalBody>

          <ModalFooter>
            <Button variant="ghost" mr={3} onClick={onClose}>取消</Button>
            <Button colorScheme="blue" type="submit" isLoading={loading}>
              儲存修改
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  )
}
