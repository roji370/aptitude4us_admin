import React, { useState } from 'react';
import { styled } from '@mui/material/styles';
import {
  Box,
  AppBar,
  Toolbar,
  IconButton,
  Typography,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Divider,
  Avatar,
  Menu,
  MenuItem,
  Tooltip,
  Dialog,
  DialogContent,
  CircularProgress,
  InputBase,
  Chip,
  Badge,
  useMediaQuery,
  useTheme
} from '@mui/material';
import {
  Menu as MenuIcon,
  GridView as DashboardIcon,
  AutoStories as CoursesIcon,
  Group as UsersIcon,
  HowToReg as AccountsIcon,
  Forum as ChatIcon,
  CreditCard as SubscriptionsIcon,
  Shield as SecurityIcon,
  Settings as SettingsIcon,
  ExitToApp as LogoutIcon,
  ChevronLeft as ChevronLeftIcon,
  Person as PersonIcon,
  Search as SearchIcon,
  Help as HelpIcon,
  KeyboardArrowDown as ChevronDownIcon,
  AdminPanelSettings as AdminIcon,
  OpenInNew as ArrowOutwardIcon,
  School as SchoolIcon,
} from '@mui/icons-material';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import SubscriptionNotificationCenter from '../SubscriptionNotificationCenter';

// Constants
const DRAWER_WIDTH = 260;

// Styled Top AppBar with translucent glassmorphic look
const StyledAppBar = styled(AppBar)(({ theme }) => ({
  backgroundColor: 'rgba(255, 255, 255, 0.90)',
  backdropFilter: 'blur(12px)',
  boxShadow: '0 1px 3px rgba(7, 26, 82, 0.04)',
  borderBottom: '1px solid #E2E8F0',
  color: '#071A52',
  zIndex: theme.zIndex.drawer + 1,
  transition: theme.transitions.create(['width', 'margin'], {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.leavingScreen,
  }),
}));

const SearchWrapper = styled('div')(({ theme }) => ({
  position: 'relative',
  borderRadius: 12,
  backgroundColor: '#F1F5F9',
  border: '1px solid #E2E8F0',
  '&:hover': {
    backgroundColor: '#E2E8F0',
  },
  marginRight: theme.spacing(2),
  marginLeft: 0,
  width: '100%',
  maxWidth: 320,
  display: 'flex',
  alignItems: 'center',
  transition: 'all 0.2s ease-in-out',
  [theme.breakpoints.down('md')]: {
    display: 'none',
  },
}));

const SearchIconWrapper = styled('div')(({ theme }) => ({
  padding: theme.spacing(0, 1.5),
  height: '100%',
  position: 'absolute',
  pointerEvents: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#94A3B8',
}));

const StyledInputBase = styled(InputBase)(({ theme }) => ({
  color: '#151C27',
  width: '100%',
  fontSize: '0.84375rem',
  fontFamily: '"Inter", sans-serif',
  '& .MuiInputBase-input': {
    padding: theme.spacing(1, 1, 1, 0),
    paddingLeft: `calc(1em + ${theme.spacing(3)})`,
    width: '100%',
  },
}));

// Navigation items definition
const navItems = [
  {
    text: 'Dashboard',
    icon: <DashboardIcon sx={{ fontSize: 20 }} />,
    path: '/dashboard',
    aliasPath: '/',
  },
  {
    text: 'Courses',
    icon: <CoursesIcon sx={{ fontSize: 20 }} />,
    path: '/courses',
  },
  {
    text: 'Users',
    icon: <UsersIcon sx={{ fontSize: 20 }} />,
    path: '/users',
    adminOnly: true,
  },
  {
    text: 'Student Accounts',
    icon: <AccountsIcon sx={{ fontSize: 20 }} />,
    path: '/accounts',
    adminOnly: true,
  },
  {
    text: 'Chat',
    icon: <ChatIcon sx={{ fontSize: 20 }} />,
    path: '/chat',
    badge: 'Live',
    adminOnly: true,
  },
  {
    text: 'Subscriptions',
    icon: <SubscriptionsIcon sx={{ fontSize: 20 }} />,
    path: '/subscriptions',
    adminOnly: true,
  },
  {
    text: 'Piracy Tracking',
    icon: <SecurityIcon sx={{ fontSize: 20 }} />,
    path: '/piracy-tracking',
    dotBadge: '#EF4444',
    adminOnly: true,
  },
  {
    text: 'Settings',
    icon: <SettingsIcon sx={{ fontSize: 20 }} />,
    path: '/settings',
    adminOnly: true,
  },
];

interface MainLayoutProps {
  children: React.ReactNode;
}

const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('lg'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const { currentUser, logout, emergencyLogout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleLogout = async () => {
    handleMenuClose();
    setLogoutLoading(true);

    try {
      await logout();
      navigate('/login');
    } catch (error) {
      console.error('Logout error:', error);
      try {
        await emergencyLogout();
        navigate('/login');
      } catch (finalError) {
        console.error('Final logout error:', finalError);
        navigate('/login');
      }
    } finally {
      setLogoutLoading(false);
    }
  };

  const handleProfileClick = () => {
    handleMenuClose();
    navigate('/profile');
  };

  // Determine current active section title for breadcrumbs
  const getBreadcrumbTitle = () => {
    const path = location.pathname;
    if (path === '/' || path === '/dashboard') return 'Overview & Operations';
    if (path.startsWith('/courses')) return 'Curriculum & Courses';
    if (path.startsWith('/accounts')) return 'Student Accounts';
    if (path.startsWith('/users')) return 'User Management';
    if (path.startsWith('/chat')) return 'Communications & Live Chat';
    if (path.startsWith('/subscriptions')) return 'Subscription Operations';
    if (path.startsWith('/piracy-tracking')) return 'Security & Piracy Tracking';
    if (path.startsWith('/settings')) return 'System Settings';
    if (path.startsWith('/profile')) return 'Administrator Profile';
    return 'Portal';
  };

  // Drawer Content matching Stitch clinical modern aesthetic
  const drawerContent = (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        backgroundColor: '#071A52',
        color: '#FFFFFF',
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, overflowY: 'auto' }}>
        {/* Brand Header */}
        <Box
          sx={{
            height: 72,
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            px: 2.5,
            backgroundColor: '#051442',
            borderBottom: '1px solid #0D2260',
          }}
        >
          <Box
            sx={{
              width: 38,
              height: 38,
              borderRadius: 2,
              backgroundColor: 'rgba(167, 255, 131, 0.15)',
              border: '1px solid rgba(167, 255, 131, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#A7FF83',
            }}
          >
            <SchoolIcon sx={{ fontSize: 22 }} />
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            <Typography
              variant="subtitle1"
              sx={{
                fontWeight: 700,
                color: '#FFFFFF',
                fontSize: '0.9375rem',
                lineHeight: 1.1,
                letterSpacing: '-0.01em',
              }}
            >
              Aptitude 4 Us
            </Typography>
            <Typography
              variant="caption"
              sx={{
                color: 'rgba(191, 219, 254, 0.7)',
                fontSize: '0.625rem',
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                mt: 0.3,
              }}
            >
              Academy Portal
            </Typography>
          </Box>
        </Box>

        {/* Section Label */}
        <Box sx={{ px: 2.5, pt: 2.5, pb: 1 }}>
          <Typography
            variant="caption"
            sx={{
              fontWeight: 700,
              fontSize: '0.6875rem',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'rgba(191, 219, 254, 0.45)',
            }}
          >
            Administration
          </Typography>
        </Box>

        {/* Navigation List */}
        <List component="nav" sx={{ px: 1.5, py: 0.5 }}>
          {navItems
            .filter((item) => !item.adminOnly || (currentUser && currentUser.role === 'admin'))
            .map((item) => {
              const isActive =
                location.pathname === item.path ||
                (item.aliasPath && location.pathname === item.aliasPath) ||
                (item.path !== '/dashboard' && item.path !== '/' && location.pathname.startsWith(item.path));

              return (
                <ListItem key={item.text} disablePadding sx={{ mb: 0.75 }}>
                  <ListItemButton
                    component={Link}
                    to={item.path}
                    onClick={() => {
                      if (isMobile) setMobileOpen(false);
                    }}
                    sx={{
                      minHeight: 42,
                      px: 1.5,
                      borderRadius: '10px',
                      backgroundColor: isActive ? 'rgba(255, 255, 255, 0.10)' : 'transparent',
                      color: isActive ? '#FFFFFF' : 'rgba(226, 232, 240, 0.75)',
                      transition: 'all 0.15s ease-in-out',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      '&:hover': {
                        backgroundColor: isActive
                          ? 'rgba(255, 255, 255, 0.14)'
                          : 'rgba(255, 255, 255, 0.05)',
                        color: '#FFFFFF',
                      },
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <ListItemIcon
                        sx={{
                          minWidth: 0,
                          color: isActive ? '#A7FF83' : 'rgba(191, 219, 254, 0.6)',
                        }}
                      >
                        {item.icon}
                      </ListItemIcon>
                      <ListItemText
                        primary={item.text}
                        primaryTypographyProps={{
                          fontSize: '0.84375rem',
                          fontWeight: isActive ? 600 : 500,
                          color: 'inherit',
                        }}
                      />
                    </Box>

                    {/* Right-hand Indicators: Active Pip or Badge */}
                    {isActive ? (
                      <Box
                        sx={{
                          width: 4,
                          height: 18,
                          borderRadius: 2,
                          backgroundColor: '#A7FF83',
                          boxShadow: '0 0 8px rgba(167, 255, 131, 0.8)',
                        }}
                      />
                    ) : item.badge ? (
                      <Chip
                        label={item.badge}
                        size="small"
                        sx={{
                          height: 18,
                          fontSize: '0.625rem',
                          fontWeight: 700,
                          backgroundColor: '#A7FF83',
                          color: '#071A52',
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em',
                        }}
                      />
                    ) : item.dotBadge ? (
                      <Box
                        sx={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          backgroundColor: item.dotBadge,
                          boxShadow: '0 0 8px rgba(239, 68, 68, 0.8)',
                        }}
                      />
                    ) : null}
                  </ListItemButton>
                </ListItem>
              );
            })}
        </List>
      </Box>

      {/* Bottom System Engine Card */}
      <Box sx={{ p: 2, m: 1.5, borderRadius: 3, backgroundColor: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.10)' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography variant="caption" sx={{ color: 'rgba(191, 219, 254, 0.7)', fontWeight: 500 }}>
            System Engine
          </Typography>
          <Chip
            label="v2.4.0"
            size="small"
            sx={{
              height: 18,
              fontSize: '0.625rem',
              fontWeight: 700,
              backgroundColor: 'rgba(255, 255, 255, 0.12)',
              color: '#A7FF83',
              borderRadius: 1,
            }}
          />
        </Box>
        <Typography variant="caption" sx={{ display: 'block', color: 'rgba(191, 219, 254, 0.5)', fontSize: '0.6875rem' }}>
          RCSI Exam Portal • Production
        </Typography>
        <Divider sx={{ my: 1, borderColor: 'rgba(255, 255, 255, 0.1)' }} />
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box
            component="a"
            href="https://rcsi.com"
            target="_blank"
            rel="noopener noreferrer"
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              color: 'rgba(191, 219, 254, 0.8)',
              fontSize: '0.6875rem',
              fontWeight: 600,
              '&:hover': { color: '#A7FF83' },
            }}
          >
            <HelpIcon sx={{ fontSize: 14 }} />
            Support Center
          </Box>
          <ArrowOutwardIcon sx={{ fontSize: 13, color: 'rgba(191, 219, 254, 0.6)' }} />
        </Box>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', backgroundColor: '#F8FAFC' }}>
      {/* Top Header Bar */}
      <StyledAppBar
        position="fixed"
        sx={{
          width: { lg: `calc(100% - ${DRAWER_WIDTH}px)` },
          ml: { lg: `${DRAWER_WIDTH}px` },
        }}
      >
        <Toolbar sx={{ height: 68, px: { xs: 2, sm: 3 }, display: 'flex', justifyContent: 'space-between' }}>
          {/* Left: Mobile Toggle & Breadcrumbs */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <IconButton
              color="inherit"
              aria-label="open drawer"
              edge="start"
              onClick={handleDrawerToggle}
              sx={{ display: { lg: 'none' }, mr: 1, color: '#071A52' }}
            >
              <MenuIcon />
            </IconButton>

            <Box
              sx={{
                width: 30,
                height: 30,
                borderRadius: 2,
                backgroundColor: '#F1F5F9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#071A52',
              }}
            >
              <AdminIcon sx={{ fontSize: 18 }} />
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography
                variant="body2"
                sx={{
                  color: '#64748B',
                  fontWeight: 500,
                  fontSize: '0.8125rem',
                  display: { xs: 'none', sm: 'inline-block' },
                }}
              >
                Admin Portal
              </Typography>
              <Typography
                variant="body2"
                sx={{ color: '#CBD5E1', display: { xs: 'none', sm: 'inline-block' } }}
              >
                /
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  color: '#071A52',
                  fontWeight: 700,
                  fontSize: '0.84375rem',
                }}
              >
                {getBreadcrumbTitle()}
              </Typography>
            </Box>
          </Box>

          {/* Right: Quick Search, Notifications, Help & Profile Pill */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            {/* Quick Search */}
            <SearchWrapper>
              <SearchIconWrapper>
                <SearchIcon sx={{ fontSize: 18 }} />
              </SearchIconWrapper>
              <StyledInputBase
                placeholder="Quick search candidates, courses, flags..."
                inputProps={{ 'aria-label': 'search' }}
              />
            </SearchWrapper>

            {/* Notification Center */}
            <SubscriptionNotificationCenter />

            {/* Help Button */}
            <Tooltip title="Help & Guides">
              <IconButton
                sx={{
                  width: 36,
                  height: 36,
                  borderRadius: 2,
                  backgroundColor: '#F8FAFC',
                  border: '1px solid #E2E8F0',
                  color: '#64748B',
                  '&:hover': { color: '#071A52', backgroundColor: '#F1F5F9' },
                }}
              >
                <HelpIcon sx={{ fontSize: 19 }} />
              </IconButton>
            </Tooltip>

            {/* Divider */}
            <Divider orientation="vertical" flexItem sx={{ height: 24, my: 'auto', mx: 0.5, borderColor: '#E2E8F0' }} />

            {/* Profile Dropdown Trigger Pill */}
            <Box
              onClick={handleMenuOpen}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.25,
                p: '4px 10px 4px 6px',
                borderRadius: 3,
                border: '1px solid #E2E8F0',
                backgroundColor: '#FFFFFF',
                cursor: 'pointer',
                transition: 'all 0.15s ease-in-out',
                '&:hover': {
                  borderColor: '#CBD5E1',
                  backgroundColor: '#F8FAFC',
                },
              }}
            >
              <Avatar
                sx={{
                  width: 32,
                  height: 32,
                  borderRadius: 2,
                  backgroundColor: '#071A52',
                  color: '#A7FF83',
                  fontSize: '0.875rem',
                  fontWeight: 700,
                }}
              >
                {currentUser?.displayName?.charAt(0) || 'A'}
              </Avatar>

              <Box sx={{ display: { xs: 'none', md: 'flex' }, flexDirection: 'column', textAlign: 'left' }}>
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: 700,
                    fontSize: '0.78125rem',
                    color: '#071A52',
                    lineHeight: 1.15,
                  }}
                >
                  {currentUser?.displayName || 'Administrator'}
                </Typography>
                <Typography
                  variant="caption"
                  sx={{
                    color: '#64748B',
                    fontSize: '0.65625rem',
                    fontWeight: 500,
                    lineHeight: 1.15,
                  }}
                >
                  {currentUser?.role === 'admin' ? 'Superadmin • Nursing Faculty' : 'Faculty Member'}
                </Typography>
              </Box>

              <ChevronDownIcon sx={{ fontSize: 16, color: '#94A3B8' }} />
            </Box>

            {/* Profile Menu */}
            <Menu
              anchorEl={anchorEl}
              open={Boolean(anchorEl)}
              onClose={handleMenuClose}
              slotProps={{
                paper: {
                  elevation: 2,
                  sx: {
                    minWidth: 220,
                    borderRadius: 3,
                    border: '1px solid #E2E8F0',
                    mt: 1.5,
                    p: 0.5,
                  },
                },
              }}
            >
              <Box sx={{ py: 1.5, px: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#071A52' }}>
                  {currentUser?.displayName || 'Administrator'}
                </Typography>
                <Typography variant="caption" sx={{ color: '#64748B' }}>
                  {currentUser?.email || 'admin@aptitude4us.com'}
                </Typography>
              </Box>
              <Divider sx={{ my: 0.5, borderColor: '#F1F5F9' }} />
              <MenuItem onClick={handleProfileClick} sx={{ borderRadius: 1.5, py: 1 }}>
                <ListItemIcon sx={{ color: '#071A52' }}>
                  <PersonIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText
                  primary="Profile Details"
                  primaryTypographyProps={{ fontSize: '0.84375rem', fontWeight: 500 }}
                />
              </MenuItem>
              <MenuItem onClick={handleLogout} sx={{ borderRadius: 1.5, py: 1, color: '#D92D20' }}>
                <ListItemIcon sx={{ color: '#D92D20' }}>
                  <LogoutIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText
                  primary="Sign Out"
                  primaryTypographyProps={{ fontSize: '0.84375rem', fontWeight: 600 }}
                />
              </MenuItem>
            </Menu>
          </Box>
        </Toolbar>
      </StyledAppBar>

      {/* Responsive Left Navigation Drawer */}
      {/* Mobile Temporary Drawer */}
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={handleDrawerToggle}
        ModalProps={{ keepMounted: true }}
        sx={{
          display: { xs: 'block', lg: 'none' },
          '& .MuiDrawer-paper': {
            boxSizing: 'border-box',
            width: DRAWER_WIDTH,
            borderRight: '1px solid #102462',
          },
        }}
      >
        {drawerContent}
      </Drawer>

      {/* Desktop Permanent Drawer */}
      <Drawer
        variant="permanent"
        sx={{
          display: { xs: 'none', lg: 'block' },
          '& .MuiDrawer-paper': {
            boxSizing: 'border-box',
            width: DRAWER_WIDTH,
            borderRight: '1px solid #102462',
            boxShadow: '4px 0 24px rgba(7, 26, 82, 0.08)',
          },
        }}
        open
      >
        {drawerContent}
      </Drawer>

      {/* Main Page Content Canvas */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          width: { lg: `calc(100% - ${DRAWER_WIDTH}px)` },
          minHeight: '100vh',
          backgroundColor: '#F8FAFC',
          pt: '68px', // offset for top appbar
        }}
      >
        <Box sx={{ p: { xs: 2.5, sm: 3.5, md: 4 }, maxWidth: 1600, mx: 'auto' }}>
          {children}
        </Box>
      </Box>

      {/* Logout Loading Dialog */}
      <Dialog
        open={logoutLoading}
        slotProps={{
          paper: {
            elevation: 0,
            sx: {
              backgroundColor: 'transparent',
              boxShadow: 'none',
              overflow: 'hidden',
            },
          },
        }}
      >
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <CircularProgress sx={{ color: '#A7FF83' }} />
            <Typography variant="body2" sx={{ mt: 2, color: 'white', fontWeight: 600 }}>
              Signing out...
            </Typography>
          </Box>
        </DialogContent>
      </Dialog>
    </Box>
  );
};

export default MainLayout;