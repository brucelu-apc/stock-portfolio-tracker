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
  Container,
} from '@chakra-ui/react'
import { supabase } from '../../services/supabase'
import { motion } from 'framer-motion'

const MotionBox = motion(Box)

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

  const handleForgotPassword = async () => {
    if (!email) {
      toast({
        title: '請輸入電子郵件',
        description: '我們需要您的 Email 來發送重設連結。',
        status: 'info',
      })
      return
    }
    
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      if (error) throw error
      toast({
        title: '重設郵件已發送',
        description: '請檢查您的信箱以重設密碼。',
        status: 'success',
      })
    } catch (error: any) {
      toast({
        title: '發送失敗',
        description: error.message,
        status: 'error',
      })
    }
  }

  return (
    <Box 
      minH="100vh" 
      display="flex" 
      alignItems="center" 
      justifyContent="center" 
      bg="ui.bg"
      bgGradient="radial(circle at 20% 20%, brand.50, transparent), radial(circle at 80% 80%, brand.100, transparent)"
    >
      <Container maxW="md">
        <MotionBox
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
        >
          <VStack spacing={8}>
            <VStack spacing={2} textAlign="center">
              <Heading size="2xl" fontWeight="900" letterSpacing="tighter" color="ui.navy">
                STOCK <Text as="span" color="brand.500">DANGO</Text>
              </Heading>
              <Text color="ui.slate" fontWeight="bold" fontSize="10px" letterSpacing="0.3em">台美股票持股追蹤器</Text>
            </VStack>

            <Card w="full" shadow="2xl" p={4} rounded="3xl">
              <CardBody>
                <VStack spacing={6}>
                  <Heading size="md" color="ui.navy">{isSignUp ? '建立您的帳號' : '歡迎回來'}</Heading>
                  
                  <Button 
                    leftIcon={
                      <svg width="18" height="18" viewBox="0 0 18 18">
                        <path fill="#4285F4" d="M17.64 9.2c0-.63-.06-1.25-.16-1.84H9v3.47h4.84c-.21 1.12-.84 2.07-1.8 2.7l2.91 2.26c1.7-1.57 2.69-3.89 2.69-6.59z"/>
                        <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.8.54-1.83.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.95v2.3C2.43 15.89 5.5 18 9 18z"/>
                        <path fill="#FBBC05" d="M3.96 10.71c-.18-.54-.28-1.12-.28-1.71s.1-1.17.28-1.71V4.99H.95C.35 6.19 0 7.56 0 9s.35 2.81.95 4.01l3.01-2.3z"/>
                        <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47.89 11.43 0 9 0 5.5 0 2.43 2.11.95 4.99L3.96 7.28c.71-2.13 2.7-3.7 5.04-3.7z"/>
                      </svg>
                    } 
                    w="full" 
                    variant="outline" 
                    h="12"
                    rounded="xl"
                    onClick={handleGoogleLogin}
                    _hover={{ bg: 'gray.50' }}
                  >
                    使用 Google 帳號繼續
                  </Button>

                  <Box w="full" display="flex" alignItems="center">
                    <Divider />
                    <Text px={4} color="gray.300" fontSize="xs" fontWeight="bold">OR</Text>
                    <Divider />
                  </Box>

                  <form style={{ width: '100%' }} onSubmit={handleAuth}>
                    <VStack spacing={4}>
                      <FormControl isRequired>
                        <FormLabel fontSize="sm" fontWeight="bold" color="ui.slate">電子郵件</FormLabel>
                        <Input 
                          h="12"
                          rounded="xl"
                          bg="gray.50"
                          border="none"
                          _focus={{ bg: 'white', boxShadow: '0 0 0 2px #0ea5e9' }}
                          type="email" 
                          value={email} 
                          onChange={(e) => setEmail(e.target.value)} 
                          placeholder="your@email.com"
                        />
                      </FormControl>
                      <FormControl isRequired>
                        <Flex justify="space-between" align="center" w="full" mb={2}>
                          <FormLabel fontSize="sm" fontWeight="bold" color="ui.slate" m={0}>密碼</FormLabel>
                          {!isSignUp && (
                            <Link fontSize="xs" color="brand.500" fontWeight="bold" onClick={handleForgotPassword}>
                              忘記密碼？
                            </Link>
                          )}
                        </Flex>
                        <Input 
                          h="12"
                          rounded="xl"
                          bg="gray.50"
                          border="none"
                          _focus={{ bg: 'white', boxShadow: '0 0 0 2px #0ea5e9' }}
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
                        bgGradient="linear(to-r, brand.500, brand.600)"
                        _hover={{ bgGradient: "linear(to-r, brand.600, brand.900)" }}
                        shadow="lg"
                      >
                        {isSignUp ? '註冊' : '登入'}
                      </Button>
                    </VStack>
                  </form>
                  <Text fontSize="sm" color="ui.slate">
                    {isSignUp ? '已經有帳號了？' : '還沒有帳號嗎？'}{' '}
                    <Link color="brand.500" fontWeight="bold" onClick={() => setIsSignUp(!isSignUp)}>
                      {isSignUp ? '立即登入' : '免費註冊'}
                    </Link>
                  </Text>
                </VStack>
              </CardBody>
            </Card>
          </VStack>
        </MotionBox>
      </Container>
    </Box>
  )
}
