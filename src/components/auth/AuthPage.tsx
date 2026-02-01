import { useState } from 'react'
import {
  Box,
  Button,
  FormControl,
  FormLabel,
  Input,
  VStack,
  Heading,
  Text,
  useToast,
  Link,
  Card,
  CardBody,
  Divider,
} from '@chakra-ui/react'
import { supabase } from '../../services/supabase'

export const AuthPage = () => {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [isSignUp, setIsSignUp] = useState(false)
  const toast = useToast()

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    
    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        toast({
          title: '註冊成功',
          description: '請檢查電子郵件確認信。',
          status: 'success',
          duration: 5000,
        })
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
    } catch (error: any) {
      toast({
        title: '錯誤',
        description: error.message,
        status: 'error',
        duration: 5000,
      })
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleLogin = async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin
        }
      })
      if (error) throw error
    } catch (error: any) {
      toast({
        title: 'Google 登入失敗',
        description: error.message,
        status: 'error',
      })
    }
  }

  return (
    <Box minH="100vh" display="flex" alignItems="center" justifyContent="center" bg="gray.50">
      <Card w="full" maxW="md" shadow="lg">
        <CardBody>
          <VStack spacing={6}>
            <Heading size="lg">{isSignUp ? '建立帳號' : '登入系統'}</Heading>
            
            <Button 
              leftIcon={<Box as="span">G</Box>} 
              w="full" 
              variant="outline" 
              onClick={handleGoogleLogin}
            >
              使用 Google 帳號繼續
            </Button>

            <Box w="full" display="flex" alignItems="center">
              <Divider />
              <Text px={2} color="gray.400" fontSize="xs">或</Text>
              <Divider />
            </Box>

            <form style={{ width: '100%' }} onSubmit={handleAuth}>
              <VStack spacing={4}>
                <FormControl isRequired>
                  <FormLabel>電子郵件</FormLabel>
                  <Input 
                    type="email" 
                    value={email} 
                    onChange={(e) => setEmail(e.target.value)} 
                    placeholder="your@email.com"
                  />
                </FormControl>
                <FormControl isRequired>
                  <FormLabel>密碼</FormLabel>
                  <Input 
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
                  isLoading={loading}
                >
                  {isSignUp ? '註冊' : '登入'}
                </Button>
              </VStack>
            </form>
            <Text>
              {isSignUp ? '已有帳號？' : '還沒有帳號？'}{' '}
              <Link color="blue.500" onClick={() => setIsSignUp(!isSignUp)}>
                {isSignUp ? '立即登入' : '立即註冊'}
              </Link>
            </Text>
          </VStack>
        </CardBody>
      </Card>
    </Box>
  )
}
