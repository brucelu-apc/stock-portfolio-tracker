import { useState } from 'react'
import {
  Box,
  Button,
  FormControl,
  FormLabel,
  Input,
  VStack,
  Heading,
  useToast,
  Card,
  CardBody,
  Container,
  Text,
} from '@chakra-ui/react'
import { supabase } from '../../services/supabase'

export const ResetPasswordPage = ({ onComplete }: { onComplete: () => void }) => {
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const toast = useToast()

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      toast({
        title: '密碼重設成功',
        description: '您現在可以使用新密碼登入。',
        status: 'success',
      })
      onComplete()
    } catch (error: any) {
      toast({
        title: '重設失敗',
        description: error.message,
        status: 'error',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Box minH="100vh" display="flex" alignItems="center" justifyContent="center" bg="ui.bg">
      <Container maxW="md">
        <Card shadow="2xl" rounded="3xl">
          <CardBody p={8}>
            <VStack spacing={6}>
              <Heading size="lg" color="ui.navy">重設您的密碼</Heading>
              <Text color="ui.slate" fontSize="sm">請輸入您的新密碼以完成重設。</Text>
              <form style={{ width: '100%' }} onSubmit={handleUpdate}>
                <VStack spacing={4}>
                  <FormControl isRequired>
                    <FormLabel fontWeight="bold">新密碼</FormLabel>
                    <Input 
                      h="12"
                      rounded="xl"
                      type="password" 
                      value={password} 
                      onChange={(e) => setPassword(e.target.value)} 
                      placeholder="********"
                    />
                  </FormControl>
                  <Button 
                    type="submit" 
                    colorScheme="blue" 
                    w="full" 
                    h="12"
                    rounded="xl"
                    isLoading={loading}
                  >
                    更新密碼
                  </Button>
                </VStack>
              </form>
            </VStack>
          </CardBody>
        </Card>
      </Container>
    </Box>
  )
}
