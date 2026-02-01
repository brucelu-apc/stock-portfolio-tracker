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
              <Text color="ui.slate" fontWeight="medium">專屬您的智能投資助手</Text>
            </VStack>

            <Card w="full" shadow="2xl" p={4} rounded="3xl">
              <CardBody>
                <VStack spacing={6}>
                  <Heading size="md" color="ui.navy">{isSignUp ? '建立您的帳號' : '歡迎回來'}</Heading>
                  
                  <Button 
                    leftIcon={<Box as="span" fontSize="lg">G</Box>} 
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
                        <FormLabel fontSize="sm" fontWeight="bold" color="ui.slate">密碼</FormLabel>
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
