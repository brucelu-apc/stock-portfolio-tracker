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
} from '@chakra-ui/react'
import { useState, useEffect } from 'react'
import { supabase } from '../../services/supabase'
import { Holding } from '../../utils/calculations'

interface Props {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  holding: Holding | null
}

export const EditHoldingModal = ({ isOpen, onClose, onSuccess, holding }: Props) => {
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

  useEffect(() => {
    if (holding) {
      setRegion(holding.region)
      setTicker(holding.ticker)
      setName(holding.name || '')
      setPrice(holding.cost_price.toString())
      setShares(holding.shares.toString())
      setDate(holding.buy_date)
      setStrategyMode(holding.strategy_mode || 'auto')
      setManualTP(holding.manual_tp?.toString() || '')
      setManualSL(holding.manual_sl?.toString() || '')
    }
  }, [holding])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!holding) return
    setLoading(true)

    try {
      const { error } = await supabase
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

      if (error) throw error

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
        <ModalHeader>編輯持股 - {ticker}</ModalHeader>
        <ModalCloseButton />
        <form onSubmit={handleSubmit}>
          <ModalBody>
            <VStack spacing={4}>
              <FormControl isRequired>
                <FormLabel>市場地區</FormLabel>
                <Select value={region} onChange={(e) => setRegion(e.target.value)}>
                  <option value="TPE">台股 (TPE)</option>
                  <option value="US">美股 (US)</option>
                </Select>
              </FormControl>

              <FormControl isRequired>
                <FormLabel>股票代碼</FormLabel>
                <Input 
                  value={ticker}
                  onChange={(e) => setTicker(e.target.value)}
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
                  <FormLabel>買入價格</FormLabel>
                  <Input 
                    type="number" 
                    step="any"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                  />
                </FormControl>
                <FormControl isRequired>
                  <FormLabel>股數</FormLabel>
                  <Input 
                    type="number" 
                    step="any"
                    value={shares}
                    onChange={(e) => setShares(e.target.value)}
                  />
                </FormControl>
              </HStack>

              <FormControl isRequired>
                <FormLabel>買入日期</FormLabel>
                <Input 
                  type="date" 
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
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

import { Divider } from '@chakra-ui/react'
