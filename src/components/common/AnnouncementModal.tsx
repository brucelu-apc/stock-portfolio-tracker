/**
 * AnnouncementModal — Shows the latest active announcement on login.
 * Re-openable from Navbar via the bell icon.
 */
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalCloseButton,
  ModalBody,
  ModalFooter,
  Button,
  Text,
  Box,
  VStack,
  Badge,
} from '@chakra-ui/react'

interface Announcement {
  id: string
  title: string
  content: string
  is_active: boolean
  created_at: string
  updated_at: string
}

interface AnnouncementModalProps {
  isOpen: boolean
  onClose: () => void
  announcement: Announcement | null
}

export const AnnouncementModal = ({ isOpen, onClose, announcement }: AnnouncementModalProps) => {
  if (!announcement) return null

  const formattedDate = new Date(announcement.updated_at).toLocaleDateString('zh-TW', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" isCentered>
      <ModalOverlay bg="blackAlpha.600" backdropFilter="blur(4px)" />
      <ModalContent rounded="2xl" shadow="2xl" mx={4}>
        <ModalHeader pb={2}>
          <VStack align="start" spacing={1}>
            <Badge colorScheme="blue" rounded="full" px={3} py={1} fontSize="xs">
              系統公告
            </Badge>
            <Text fontSize="xl" fontWeight="extrabold" color="ui.navy">
              {announcement.title}
            </Text>
          </VStack>
        </ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Box
            bg="gray.50"
            p={5}
            rounded="xl"
            whiteSpace="pre-wrap"
            fontSize="sm"
            lineHeight="tall"
            color="gray.700"
          >
            {announcement.content}
          </Box>
          <Text fontSize="xs" color="gray.400" mt={3} textAlign="right">
            更新於 {formattedDate}
          </Text>
        </ModalBody>
        <ModalFooter>
          <Button
            colorScheme="blue"
            rounded="xl"
            onClick={onClose}
            bgGradient="linear(to-r, brand.500, brand.600)"
            _hover={{ bgGradient: "linear(to-r, brand.600, brand.900)" }}
          >
            我知道了
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
