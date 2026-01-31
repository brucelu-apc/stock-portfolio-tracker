import { useState, useEffect } from 'react'
import { 
  Box, 
  Spinner, 
  Center, 
  Container, 
  Button, 
  Flex, 
  Heading, 
  useDisclosure 
} from '@chakra-ui/react'
import { AddIcon } from '@chakra-ui/icons'
import { supabase } from './services/supabase'
import { AuthPage } from './components/auth/AuthPage'
import { Navbar } from './components/common/Navbar'
import { AddHoldingModal } from './components/holdings/AddHoldingModal'
import { HoldingsTable } from './components/holdings/HoldingsTable'
import { Session } from '@supabase/supabase-js'

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [holdings, setHoldings] = useState<any[]>([])
  const { isOpen, onOpen, onClose } = useDisclosure()

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
      if (session) fetchHoldings()
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) fetchHoldings()
    })

    return () => subscription.unsubscribe()
  }, [])

  const fetchHoldings = async () => {
    const { data, error } = await supabase
      .from('portfolio_holdings')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching holdings:', error)
    } else {
      setHoldings(data || [])
    }
  }

  if (loading) {
    return (
      <Center h="100vh">
        <Spinner size="xl" color="blue.500" />
      </Center>
    )
  }

  if (!session) {
    return <AuthPage />
  }

  return (
    <Box minH="100vh" bg="gray.50">
      <Navbar userEmail={session.user.email} />
      
      <Container maxW="container.xl" py={8}>
        <Flex justify="space-between" align="center" mb={6}>
          <Heading size="lg">投資組合</Heading>
          <Button 
            leftIcon={<AddIcon />} 
            colorScheme="blue" 
            onClick={onOpen}
          >
            新增持股
          </Button>
        </Flex>

        <HoldingsTable holdings={holdings} />

        <AddHoldingModal 
          isOpen={isOpen} 
          onClose={onClose} 
          onSuccess={fetchHoldings} 
        />
      </Container>
    </Box>
  )
}

export default App
