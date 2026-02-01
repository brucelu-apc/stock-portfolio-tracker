import { extendTheme, type ThemeConfig } from '@chakra-ui/react'

const config: ThemeConfig = {
  initialColorMode: 'light',
  useSystemColorMode: false,
}

const theme = extendTheme({
  config,
  fonts: {
    heading: "'Inter', -apple-system, system-ui, sans-serif",
    body: "'Inter', -apple-system, system-ui, sans-serif",
  },
  colors: {
    brand: {
      50: '#f0f9ff',
      100: '#e0f2fe',
      500: '#0ea5e9', // Sky blue
      600: '#0284c7',
      900: '#0c4a6e',
    },
    ui: {
      bg: '#F8FAFC',
      card: '#FFFFFF',
      navy: '#0F172A',
      slate: '#64748B',
    },
    profit: '#E53E3E', // Taiwan Red
    loss: '#38A169',   // Taiwan Green
  },
  components: {
    Card: {
      baseStyle: {
        container: {
          borderRadius: '20px',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.05)',
          borderWidth: '1px',
          borderColor: 'gray.50',
          overflow: 'hidden',
        }
      }
    },
    Button: {
      baseStyle: {
        borderRadius: '12px',
        fontWeight: 'bold',
      },
    },
    Table: {
      variants: {
        simple: {
          th: {
            color: 'ui.slate',
            textTransform: 'none',
            fontSize: 'xs',
            letterSpacing: 'wider',
          },
          td: {
            fontSize: 'sm',
          }
        }
      }
    }
  },
  styles: {
    global: {
      body: {
        bg: 'ui.bg',
        color: 'ui.navy',
      }
    }
  }
})

export default theme
