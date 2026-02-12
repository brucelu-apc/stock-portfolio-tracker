import {
  Box,
  Heading,
  VStack,
  FormControl,
  FormLabel,
  Input,
  Button,
  useToast,
  Divider,
  Text,
  Badge,
  HStack,
} from '@chakra-ui/react'
import { ArrowBackIcon } from '@chakra-ui/icons'
import { useState } from 'react'
import { supabase } from '../../services/supabase'
import { MessagingSettings } from './MessagingSettings'

interface SettingsPageProps {
  userId: string
  userEmail: string | undefined
  status: string | undefined
  onNavigate: (page: string) => void
}

export const SettingsPage = ({ userId, userEmail, status, onNavigate }: SettingsPageProps) => {
  const [newPassword, setNewPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const toast = useToast()

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    const { error } = await supabase.auth.updateUser({ password: newPassword })

    if (error) {
      toast({ title: '修改密碼失敗', description: error.message, status: 'error' })
    } else {
      toast({ title: '修改密碼成功', status: 'success' })
      setNewPassword('')
    }
    setLoading(false)
  }

  return (
    <Box maxW="md" mx="auto">
      <HStack justify="space-between" mb={6}>
        <Heading size="md">帳號設定</Heading>
        <Button
          leftIcon={<ArrowBackIcon />}
          variant="outline"
          size="sm"
          onClick={() => onNavigate('dashboard')}
        >
          返回儀表板
        </Button>
      </HStack>

      <VStack spacing={8} align="stretch" bg="white" p={6} rounded="lg" shadow="sm">
        <Box>
          <Text color="gray.500" mb={1}>帳號電子郵件</Text>
          <Text fontWeight="bold" mb={4}>{userEmail}</Text>

          <Text color="gray.500" mb={1}>目前帳號狀態</Text>
          <Badge colorScheme={status === 'enabled' ? 'green' : 'yellow'}>
            {status?.toUpperCase() || 'UNKNOWN'}
          </Badge>
        </Box>

        <Divider />

        <form onSubmit={handleUpdatePassword}>
          <VStack spacing={4} align="stretch">
            <Text fontWeight="bold">修改登入密碼</Text>
            <FormControl isRequired>
              <FormLabel fontSize="sm">新密碼</FormLabel>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="請輸入新密碼"
              />
            </FormControl>
            <Button colorScheme="blue" type="submit" isLoading={loading}>
              更新密碼
            </Button>
          </VStack>
        </form>

        <Divider />

        {/* Messaging & Notification Settings */}
        <MessagingSettings userId={userId} />
      </VStack>
    </Box>
  )
}
