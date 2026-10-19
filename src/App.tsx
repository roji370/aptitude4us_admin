import React, { lazy } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { CssBaseline, CircularProgress, Box } from '@mui/material';
import { AuthProvider, useAuth } from './context/AuthContext';
import theme from './styles/theme';
import Login from './pages/Login';
import MainLayout from './components/layout/MainLayout';
import ProtectedRoute from './components/ProtectedRoute';
import NotificationHandler from './components/NotificationHandler';
import SubscriptionService from './components/SubscriptionService';

// Lazy-loaded pages
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Courses = lazy(() => import('./pages/Courses'));
const CourseDetail = lazy(() => import('./pages/CourseDetail'));
const CreateCourse = lazy(() => import('./pages/CreateCourse'));
const EditCourse = lazy(() => import('./pages/EditCourse'));
const ModuleDetail = lazy(() => import('./pages/ModuleDetail'));
const Users = lazy(() => import('./pages/Users'));
const UserDetail = lazy(() => import('./pages/UserDetail'));
const UserEdit = lazy(() => import('./pages/UserEdit'));
const CreateUser = lazy(() => import('./pages/CreateUser'));
const Settings = lazy(() => import('./pages/Settings'));
const Profile = lazy(() => import('./pages/Profile'));
const NotFound = lazy(() => import('./pages/NotFound'));
const AdminChat = lazy(() => import('./pages/AdminChat'));
const Notifications = lazy(() => import('./pages/Notifications'));

// Subscription pages
const SubscriptionDashboard = lazy(() => import('./pages/SubscriptionDashboard'));
const SubscriptionManagement = lazy(() => import('./pages/SubscriptionManagement'));
const SubscriptionDetail = lazy(() => import('./pages/SubscriptionDetail'));

// Piracy Tracking page
const PiracyTracking = lazy(() => import('./pages/PiracyTracking'));

// Accounts page
const Accounts = lazy(() => import('./pages/Accounts'));

// Loading component
const LoadingComponent: React.FC = () => (
  <Box
    sx={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      height: '100vh',
    }}
  >
    <CircularProgress size={60} />
  </Box>
);

// Main App component
const AppContent: React.FC = () => {
  const { loading } = useAuth();

  if (loading) {
    return <LoadingComponent />;
  }

  return (
    <>
      <NotificationHandler />
      <SubscriptionService />
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route
          path="/"
          element={
            <ProtectedRoute>
              <MainLayout>
                <React.Suspense fallback={<LoadingComponent />}>
                  <Dashboard />
                </React.Suspense>
              </MainLayout>
            </ProtectedRoute>
          }
        />

        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <MainLayout>
                <React.Suspense fallback={<LoadingComponent />}>
                  <Dashboard />
                </React.Suspense>
              </MainLayout>
            </ProtectedRoute>
          }
        />

        <Route
          path="/courses"
          element={
            <ProtectedRoute>
              <MainLayout>
                <React.Suspense fallback={<LoadingComponent />}>
                  <Courses />
                </React.Suspense>
              </MainLayout>
            </ProtectedRoute>
          }
        />

        <Route
          path="/courses/create"
          element={
            <ProtectedRoute requiredRole="admin">
              <MainLayout>
                <React.Suspense fallback={<LoadingComponent />}>
                  <CreateCourse />
                </React.Suspense>
              </MainLayout>
            </ProtectedRoute>
          }
        />

        <Route
          path="/courses/:id"
          element={
            <ProtectedRoute checkCourseAccess>
              <MainLayout>
                <React.Suspense fallback={<LoadingComponent />}>
                  <CourseDetail />
                </React.Suspense>
              </MainLayout>
            </ProtectedRoute>
          }
        />

        <Route
          path="/courses/:id/edit"
          element={
            <ProtectedRoute requiredRole="admin" checkCourseAccess>
              <MainLayout>
                <React.Suspense fallback={<LoadingComponent />}>
                  <EditCourse />
                </React.Suspense>
              </MainLayout>
            </ProtectedRoute>
          }
        />

        <Route
          path="/courses/:courseId/modules/:moduleId"
          element={
            <ProtectedRoute checkCourseAccess>
              <MainLayout>
                <React.Suspense fallback={<LoadingComponent />}>
                  <ModuleDetail />
                </React.Suspense>
              </MainLayout>
            </ProtectedRoute>
          }
        />

        {/* Subscription Routes */}
        <Route
          path="/subscriptions"
          element={
            <ProtectedRoute requiredRole="admin">
              <MainLayout>
                <React.Suspense fallback={<LoadingComponent />}>
                  <SubscriptionDashboard />
                </React.Suspense>
              </MainLayout>
            </ProtectedRoute>
          }
        />

        <Route
          path="/subscriptions/manage"
          element={
            <ProtectedRoute requiredRole="admin">
              <MainLayout>
                <React.Suspense fallback={<LoadingComponent />}>
                  <SubscriptionManagement />
                </React.Suspense>
              </MainLayout>
            </ProtectedRoute>
          }
        />

        <Route
          path="/subscriptions/detail/:id"
          element={
            <ProtectedRoute requiredRole="admin">
              <MainLayout>
                <React.Suspense fallback={<LoadingComponent />}>
                  <SubscriptionDetail />
                </React.Suspense>
              </MainLayout>
            </ProtectedRoute>
          }
        />

        {/* Piracy Tracking Route */}
        <Route
          path="/piracy-tracking"
          element={
            <ProtectedRoute requiredRole="admin">
              <MainLayout>
                <React.Suspense fallback={<LoadingComponent />}>
                  <PiracyTracking />
                </React.Suspense>
              </MainLayout>
            </ProtectedRoute>
          }
        />

        {/* Accounts/Students Route */}
        <Route
          path="/accounts"
          element={
            <ProtectedRoute requiredRole="admin">
              <MainLayout>
                <React.Suspense fallback={<LoadingComponent />}>
                  <Accounts />
                </React.Suspense>
              </MainLayout>
            </ProtectedRoute>
          }
        />

        <Route
          path="/users"
          element={
            <ProtectedRoute requiredRole="admin">
              <MainLayout>
                <React.Suspense fallback={<LoadingComponent />}>
                  <Users />
                </React.Suspense>
              </MainLayout>
            </ProtectedRoute>
          }
        />

        <Route
          path="/users/create"
          element={
            <ProtectedRoute requiredRole="admin">
              <MainLayout>
                <React.Suspense fallback={<LoadingComponent />}>
                  <CreateUser />
                </React.Suspense>
              </MainLayout>
            </ProtectedRoute>
          }
        />

        <Route
          path="/users/:id"
          element={
            <ProtectedRoute requiredRole="admin">
              <MainLayout>
                <React.Suspense fallback={<LoadingComponent />}>
                  <UserDetail />
                </React.Suspense>
              </MainLayout>
            </ProtectedRoute>
          }
        />

        <Route
          path="/users/:id/edit"
          element={
            <ProtectedRoute requiredRole="admin">
              <MainLayout>
                <React.Suspense fallback={<LoadingComponent />}>
                  <UserEdit />
                </React.Suspense>
              </MainLayout>
            </ProtectedRoute>
          }
        />

        <Route
          path="/settings"
          element={
            <ProtectedRoute requiredRole="admin">
              <MainLayout>
                <React.Suspense fallback={<LoadingComponent />}>
                  <Settings />
                </React.Suspense>
              </MainLayout>
            </ProtectedRoute>
          }
        />

        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <MainLayout>
                <React.Suspense fallback={<LoadingComponent />}>
                  <Profile />
                </React.Suspense>
              </MainLayout>
            </ProtectedRoute>
          }
        />

        <Route
          path="/chat"
          element={
            <ProtectedRoute requiredRole="admin">
              <MainLayout>
                <React.Suspense fallback={<LoadingComponent />}>
                  <AdminChat />
                </React.Suspense>
              </MainLayout>
            </ProtectedRoute>
          }
        />

        <Route
          path="/notifications"
          element={
            <ProtectedRoute>
              <MainLayout>
                <React.Suspense fallback={<LoadingComponent />}>
                  <Notifications />
                </React.Suspense>
              </MainLayout>
            </ProtectedRoute>
          }
        />

        <Route
          path="*"
          element={
            <MainLayout>
              <React.Suspense fallback={<LoadingComponent />}>
                <NotFound />
              </React.Suspense>
            </MainLayout>
          }
        />
      </Routes>
    </>
  );
};

const App: React.FC = () => {
  return (
    <Router>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </ThemeProvider>
    </Router>
  );
};

export default App;
