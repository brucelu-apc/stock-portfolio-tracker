/**
 * PersonalInfoModal — Shown on first login when user hasn't filled in registration info.
 * Collects: display_name, phone, company, notes.
 * Saves to Supabase user_registration_info table, then triggers admin email notification.
 */
import { useState } from 'react'
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  FormControl,
  FormLabel,
  Input,
  Textarea,
  VStack,
  Text,
  useToast,
} from '@chakra-ui/react'
import { supabase } from '../../services/supabase'
import { notifyRegistration } from '../../services/backend'

interface PersonalInfoModalProps {
  isOpen: boolean
  onClose: () => void
  userId: string
  userEmail: string
}

export const PersonalInfoModal = ({ isOpen, onClose, userId, userEmail }: PersonalInfoModalProps) => {
  const [displayName, setDisplayName] = useState('')
  const [phone, setPhone] = useState('')
  const [company, setCompany] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const toast = useToast()

  const handleSubmit = async () => {
    setSaving(true)

    try {
      // 1. Save to Supabase
      const { error } = await supabase
        .from('user_registration_info')
        .upsert(
          {
            user_id: userId,
            display_name: displayName.trim(),
            phone: phone.trim(),
            company: company.trim(),
            notes: notes.trim(),
          },
          { onConflict: 'user_id' }
        )

      if (error) throw error

      // 2. Trigger admin email notification (fire-and-forget)
      notifyRegistration({
        user_id: userId,
        email: userEmail,
        display_name: displayName.trim(),
        phone: phone.trim(),
        company: company.trim(),
        notes: notes.trim(),
      }).catch((err) => {
        console.warn('Registration email notification failed:', err)
      })

      toast({
        title: '個人資訊已儲存',
        description: '感謝您完成註冊！請等待管理員審核啟用帳號。',
        status: 'success',
        duration: 5000,
      })

      onClose()
    } catch (err: any) {
      toast({
        title: '儲存失敗',
        description: err.message,
        status: 'error',
        duration: 4000,
      })
    } finally {
      setSaving(false)
    }
  }

  const handleSkip = () => {
    // Still save a blank record so the modal doesn't show again
    supabase
      .from('user_registration_info')
      .upsert(
        { user_id: userId, display_name: '', phone: '', company: '', notes: '' },
        { onConflict: 'user_id' }
      )
      .then(() => {})
      .catch(() => {})

    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={handleSkip} size="lg" isCentered closeOnOverlayClick={false}>
      <ModalOverlay bg="blackAlpha.600" backdropFilter="blur(4px)" />
      <ModalContent rounded="2xl" shadow="2xl" mx={4}>
        <ModalHeader>
          <VStack align="start" spacing={1}>
            <Text fontSize="xl" fontWeight="extrabold" color="ui.navy">
              歡迎加入 Stock Dango
            </Text>
            <Text fontSize="sm" color="gray.500" fontWeight="normal">
              請填寫您的個人資訊，方便管理員審核帳號
            </Text>
          </VStack>
        </ModalHeader>
        <ModalBody>
          <VStack spacing={4}>
            <FormControl>
              <FormLabel fontSize="sm" fontWeight="bold" color="ui.slate">
                姓名 / 暱稱
              </FormLabel>
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="例：王小明"
                rounded="xl"
                bg="gray.50"
                border="none"
                _focus={{ bg: 'white', boxShadow: '0 0 0 2px #0ea5e9' }}
              />
            </FormControl>

            <FormControl>
              <FormLabel fontSize="sm" fontWeight="bold" color="ui.slate">
                聯絡電話
              </FormLabel>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="例：0912-345-678"
                rounded="xl"
                bg="gray.50"
                border="none"
                _focus={{ bg: 'white', boxShadow: '0 0 0 2px #0ea5e9' }}
              />
            </FormControl>

            <FormControl>
              <FormLabel fontSize="sm" fontWeight="bold" color="ui.slate">
                公司 / 單位
              </FormLabel>
              <Input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="例：ABC 科技公司"
                rounded="xl"
                bg="gray.50"
                border="none"
                _focus={{ bg: 'white', boxShadow: '0 0 0 2px #0ea5e9' }}
              />
            </FormControl>

            <FormControl>
              <FormLabel fontSize="sm" fontWeight="bold" color="ui.slate">
                備註
              </FormLabel>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="任何想告知管理員的事項..."
                rounded="xl"
                bg="gray.50"
                border="none"
                rows={3}
                _focus={{ bg: 'white', boxShadow: '0 0 0 2px #0ea5e9' }}
              />
            </FormControl>
          </VStack>
        </ModalBody>
        <ModalFooter gap={3}>
          <Button variant="ghost" onClick={handleSkip} rounded="xl">
            稍後再填
          </Button>
          <Button
            colorScheme="blue"
            onClick={handleSubmit}
            isLoading={saving}
            rounded="xl"
            bgGradient="linear(to-r, brand.500, brand.600)"
            _hover={{ bgGradient: "linear(to-r, brand.600, brand.900)" }}
          >
            送出
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
