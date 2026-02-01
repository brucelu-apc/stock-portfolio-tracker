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
} from '@chakra-ui/react'
import { useState } from 'react'
import { supabase } from '../../services/supabase'

interface Props {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

export const AddHoldingModal = ({ isOpen, onClose, onSuccess }: Props) => {
  const [region, setRegion] = useState('TPE')
  const [ticker, setTicker] = useState('')
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [shares, setShares] = useState('')
  const [buyFee, setBuyFee] = useState('')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [loading, setLoading] = useState(false)
  const toast = useToast()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('未登入')

      const costPriceNum = parseFloat(price)
      const sharesNum = parseFloat(shares)
      const buyFeeNum = parseFloat(buyFee) || 0

      if (isNaN(costPriceNum) || costPriceNum <= 0) throw new Error('請輸入有效的買入價格')
      if (isNaN(sharesNum) || sharesNum <= 0) throw new Error('請輸入有效的持有股數')

      // Validate ticker based on region
      const tickerClean = ticker.trim().toUpperCase()
      if (region === 'US' && !/^[A-Z]+$/.test(tickerClean)) {
        throw new Error('美股代碼必須為英文字母')
      }
      if (region === 'TPE' && !/^[A-Z0-9.]+$/.test(tickerClean)) {
        throw new Error('台股代碼格式錯誤')
      }

      // Check if existing records exist (to handle is_multiple logic)
      const { data: existing } = await supabase
        .from('portfolio_holdings')
        .select('id')
        .eq('user_id', user.id)
        .eq('ticker', tickerClean)

      const isMultiple = existing && existing.length > 0

      // Insert new holding
      const { error } = await supabase.from('portfolio_holdings').insert({
        user_id: user.id,
        region,
        ticker: tickerClean,
        name: name || tickerClean,
        cost_price: parseFloat(price),
        shares: parseFloat(shares),
        buy_fee: parseFloat(buyFee) || 0,
        buy_date: date,
        is_multiple: isMultiple,
        strategy_mode: 'auto',
        high_watermark_price: parseFloat(price)
      })

      if (error) throw error

      // Update old records if this makes it multiple
      if (isMultiple) {
        await supabase
          .from('portfolio_holdings')
          .update({ is_multiple: true })
          .eq('user_id', user.id)
          .eq('ticker', tickerClean)
      }

      toast({ title: '新增成功', status: 'success' })
      onSuccess()
      onClose()
      // Reset form
      setTicker('')
      setName('')
      setPrice('')
      setShares('')
    } catch (error: any) {
      toast({ title: '錯誤', description: error.message, status: 'error' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>新增持股</ModalHeader>
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
                  placeholder={region === 'TPE' ? '如: 2330' : '如: AAPL'} 
                  value={ticker}
                  onChange={(e) => setTicker(e.target.value)}
                />
              </FormControl>

              <FormControl>
                <FormLabel>股票名稱 (選填)</FormLabel>
                <Input 
                  placeholder="如: 台積電" 
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
                <FormControl>
                  <FormLabel>手續費</FormLabel>
                  <Input 
                    type="number" 
                    step="any"
                    value={buyFee}
                    onChange={(e) => setBuyFee(e.target.value)}
                    placeholder="0"
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
            </VStack>
          </ModalBody>

          <ModalFooter>
            <Button variant="ghost" mr={3} onClick={onClose}>取消</Button>
            <Button colorScheme="blue" type="submit" isLoading={loading}>
              新增持股
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  )
}
