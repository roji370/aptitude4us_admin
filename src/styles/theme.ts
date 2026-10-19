import { createTheme } from '@mui/material/styles';

// Theme based on Stitch Admin Reference and Student App design language
const theme = createTheme({
  palette: {
    primary: {
      main: '#071A52', // Deep Academy Navy
      light: '#1B365D',
      dark: '#051442',
      contrastText: '#FFFFFF',
    },
    secondary: {
      main: '#006B5F', // Clinical Teal
      light: '#10B981',
      dark: '#004D40',
      contrastText: '#FFFFFF',
    },
    error: {
      main: '#D92D20', // Critical Crimson
      light: '#FEE2E2',
      dark: '#991B1B',
      contrastText: '#FFFFFF',
    },
    warning: {
      main: '#F59E0B', // Diagnostic Amber
      light: '#FEF3C7',
      dark: '#92400E',
      contrastText: '#FFFFFF',
    },
    info: {
      main: '#028090', // Deep Cyan
      light: '#E0F2FE',
      dark: '#0369A1',
      contrastText: '#FFFFFF',
    },
    success: {
      main: '#10B981', // Functional Correct Green
      light: '#ECFDF5',
      dark: '#065F46',
      contrastText: '#FFFFFF',
    },
    background: {
      default: '#F8FAFC', // Low-glare cool canvas
      paper: '#FFFFFF',   // Pure White for elevated cards
    },
    text: {
      primary: '#071A52',   // Primary headers and emphasized values
      secondary: '#64748B', // Secondary meta-information and labels
    },
    divider: '#E2E8F0', // Crisp subtle separators
  },
  typography: {
    fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    h1: {
      fontSize: '2.25rem',
      fontWeight: 700,
      lineHeight: 1.2,
      letterSpacing: '-0.02em',
      color: '#071A52',
    },
    h2: {
      fontSize: '1.875rem',
      fontWeight: 700,
      lineHeight: 1.25,
      letterSpacing: '-0.02em',
      color: '#071A52',
    },
    h3: {
      fontSize: '1.5rem',
      fontWeight: 700,
      lineHeight: 1.3,
      letterSpacing: '-0.01em',
      color: '#071A52',
    },
    h4: {
      fontSize: '1.25rem',
      fontWeight: 600,
      lineHeight: 1.35,
      letterSpacing: '-0.01em',
      color: '#071A52',
    },
    h5: {
      fontSize: '1.125rem',
      fontWeight: 600,
      lineHeight: 1.4,
      color: '#071A52',
    },
    h6: {
      fontSize: '1rem',
      fontWeight: 600,
      lineHeight: 1.4,
      color: '#071A52',
    },
    subtitle1: {
      fontSize: '0.9375rem',
      fontWeight: 500,
      lineHeight: 1.45,
      color: '#64748B',
    },
    subtitle2: {
      fontSize: '0.8125rem',
      fontWeight: 600,
      lineHeight: 1.45,
      letterSpacing: '0.01em',
      color: '#64748B',
    },
    body1: {
      fontSize: '0.9375rem',
      lineHeight: 1.5,
      color: '#151C27',
    },
    body2: {
      fontSize: '0.8125rem',
      lineHeight: 1.5,
      color: '#64748B',
    },
    button: {
      textTransform: 'none',
      fontWeight: 600,
      fontSize: '0.875rem',
      letterSpacing: '0.01em',
    },
    caption: {
      fontSize: '0.75rem',
      lineHeight: 1.4,
      letterSpacing: '0.02em',
      color: '#64748B',
    },
    overline: {
      fontSize: '0.6875rem',
      fontWeight: 700,
      lineHeight: 1.4,
      letterSpacing: '0.05em',
      textTransform: 'uppercase',
      color: '#64748B',
    },
  },
  shape: {
    borderRadius: 10,
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: '#F8FAFC',
          color: '#151C27',
          fontFamily: '"Inter", sans-serif',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: '#FFFFFF',
          color: '#071A52',
          boxShadow: '0 1px 3px rgba(7, 26, 82, 0.04)',
          borderBottom: '1px solid #E2E8F0',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: '#071A52', // Deep Navy Sidebar
          color: '#FFFFFF',
          borderRight: '1px solid #102462',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          textTransform: 'none',
          fontWeight: 600,
          boxShadow: 'none',
          padding: '8px 16px',
          transition: 'all 0.15s ease-in-out',
          '&:hover': {
            boxShadow: 'none',
          },
          '&:focus': {
            outline: 'none',
          },
        },
        containedPrimary: {
          backgroundColor: '#071A52',
          color: '#FFFFFF',
          '&:hover': {
            backgroundColor: '#0C2570',
          },
        },
        containedSecondary: {
          backgroundColor: '#006B5F',
          color: '#FFFFFF',
          '&:hover': {
            backgroundColor: '#005047',
          },
        },
        outlinedPrimary: {
          borderColor: '#E2E8F0',
          color: '#071A52',
          backgroundColor: '#FFFFFF',
          '&:hover': {
            borderColor: '#CBD5E1',
            backgroundColor: '#F8FAFC',
          },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 16,
          backgroundColor: '#FFFFFF',
          border: '1px solid #E2E8F0',
          boxShadow: '0 1px 3px rgba(7, 26, 82, 0.04), 0 4px 12px rgba(7, 26, 82, 0.03)',
          overflow: 'hidden',
          transition: 'box-shadow 0.2s ease-in-out, border-color 0.2s ease-in-out',
          '&:hover': {
            boxShadow: '0 4px 16px rgba(7, 26, 82, 0.06)',
          },
        },
      },
    },
    MuiCardHeader: {
      styleOverrides: {
        root: {
          padding: '20px 24px 12px 24px',
        },
        title: {
          fontSize: '1.0625rem',
          fontWeight: 700,
          color: '#071A52',
        },
        subheader: {
          fontSize: '0.8125rem',
          color: '#64748B',
        },
      },
    },
    MuiCardContent: {
      styleOverrides: {
        root: {
          padding: '20px 24px',
          '&:last-child': {
            paddingBottom: '20px',
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          backgroundColor: '#FFFFFF',
        },
        elevation0: {
          border: '1px solid #E2E8F0',
          boxShadow: 'none',
        },
        elevation1: {
          border: '1px solid #E2E8F0',
          boxShadow: '0 1px 3px rgba(7, 26, 82, 0.04), 0 4px 12px rgba(7, 26, 82, 0.03)',
        },
        elevation2: {
          border: '1px solid #E2E8F0',
          boxShadow: '0 4px 16px rgba(7, 26, 82, 0.08), 0 1px 4px rgba(7, 26, 82, 0.04)',
        },
        elevation3: {
          boxShadow: '0 12px 32px rgba(7, 26, 82, 0.12), 0 2px 8px rgba(7, 26, 82, 0.06)',
        },
      },
    },
    MuiTable: {
      styleOverrides: {
        root: {
          borderCollapse: 'separate',
          borderSpacing: '0',
        },
      },
    },
    MuiTableHead: {
      styleOverrides: {
        root: {
          backgroundColor: '#F8FAFC',
          '& .MuiTableCell-root': {
            color: '#64748B',
            fontWeight: 700,
            fontSize: '0.6875rem',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            borderBottom: '1px solid #E2E8F0',
            backgroundColor: '#F8FAFC',
            padding: '10px 16px',
          },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          padding: '14px 16px',
          borderBottom: '1px solid #F1F5F9',
          color: '#151C27',
          fontSize: '0.84375rem',
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          transition: 'background-color 0.15s ease-in-out',
          '&:hover': {
            backgroundColor: '#F8FAFC',
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 9999,
          fontWeight: 600,
          fontSize: '0.75rem',
          height: 24,
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: 8,
            backgroundColor: '#FFFFFF',
            '& fieldset': {
              borderColor: '#E2E8F0',
              borderWidth: '1px',
            },
            '&:hover fieldset': {
              borderColor: '#CBD5E1',
            },
            '&.Mui-focused fieldset': {
              borderColor: '#071A52',
              borderWidth: '1.5px',
            },
          },
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          backgroundColor: '#FFFFFF',
          '& fieldset': {
            borderColor: '#E2E8F0',
            borderWidth: '1px',
          },
          '&:hover fieldset': {
            borderColor: '#CBD5E1',
          },
          '&.Mui-focused fieldset': {
            borderColor: '#071A52',
            borderWidth: '1.5px',
          },
        },
        input: {
          padding: '10px 14px',
          fontSize: '0.875rem',
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 20,
          boxShadow: '0 20px 25px -5px rgba(7, 26, 82, 0.15), 0 8px 10px -6px rgba(7, 26, 82, 0.08)',
          border: '1px solid #E2E8F0',
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          fontWeight: 500,
          fontSize: '0.875rem',
        },
        standardSuccess: {
          backgroundColor: '#ECFDF5',
          color: '#065F46',
          border: '1px solid #A7F3D0',
        },
        standardWarning: {
          backgroundColor: '#FFFBEB',
          color: '#92400E',
          border: '1px solid #FDE68A',
        },
        standardError: {
          backgroundColor: '#FEF3F2',
          color: '#991B1B',
          border: '1px solid #FECDCA',
        },
        standardInfo: {
          backgroundColor: '#EFF6FF',
          color: '#1E40AF',
          border: '1px solid #BFDBFE',
        },
      },
    },
  },
});

export default theme;