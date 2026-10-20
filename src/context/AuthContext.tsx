import React, { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { onIdTokenChanged } from 'firebase/auth';
import { auth } from '../firebase/config';
import { logOut, emergencyLogOut } from '../services/authService';
import { emergencyMarkTokensInactive } from '../services/fcmService';
import type { User } from '../services/authService';

interface AuthContextType {
  currentUser: User | null;
  loading: boolean;
  logout: () => Promise<void>;
  emergencyLogout: () => Promise<void>;
  isAdmin: boolean;
  assignedCourseIds: string[];
  customClaims: Record<string, unknown> | null;
  setUserAfterLogin: (user: User) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [assignedCourseIds, setAssignedCourseIds] = useState<string[]>([]);
  const [customClaims, setCustomClaims] = useState<Record<string, unknown> | null>(null);

  // Function to set user after successful manual login
  const setUserAfterLogin = (user: User) => {
    console.log("Setting user after manual login:", user);
            setCurrentUser(user);
            setIsAdmin(user.role === 'admin');
            setAssignedCourseIds(user.assignedCourseIds || []);
  };

  useEffect(() => {
    console.log("Auth effect starting - only handling token changes, no automatic login");
    
    let unsubscribeToken: (() => void) | null = null;

    try {
      // Listen specifically for token changes to get custom claims
      // This keeps the token fresh but doesn't automatically log the user in
      unsubscribeToken = onIdTokenChanged(auth, async (firebaseUser) => {
        console.log("Token changed event fired");
        if (firebaseUser && currentUser) { // Only update for signed-in users
          try {
            console.log("Getting token result for user:", firebaseUser.uid);
            const tokenResult = await firebaseUser.getIdTokenResult();
            console.log("Token claims received:", tokenResult.claims);
            setCustomClaims(tokenResult.claims as Record<string, unknown>);
            
            // Use claims directly for role and access
            if (tokenResult.claims.role === 'admin') {
              console.log("Admin role found in claims");
              setIsAdmin(true);
            }
            
            if (tokenResult.claims.assignedCourseIds) {
              console.log("Assigned courses found in claims:", tokenResult.claims.assignedCourseIds);
              setAssignedCourseIds(tokenResult.claims.assignedCourseIds as string[]);
            }
          } catch (error) {
            console.error('Error getting token claims:', error);
          }
        } else if (!firebaseUser) {
          console.log("No user in token changed event");
          setCustomClaims(null);
        }
      });
    } catch (error) {
      console.warn('Firebase auth listener failed:', error);
    }

    return () => {
      if (unsubscribeToken) unsubscribeToken();
    };
  }, [currentUser]); // Only re-run when currentUser changes

  const logout = async () => {
    try {
      setLoading(true);
      
      // Start a timeout for emergency logout
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => {
          reject(new Error('Logout timeout exceeded'));
        }, 5000); // 5 second timeout
      });
      
      // Race between normal logout and timeout
      await Promise.race([
        logOut(),
        timeoutPromise
      ]);
      
      // If we get here, normal logout completed before timeout
      // Clean up tokens in the background after logout
      if (currentUser?.uid) {
        emergencyMarkTokensInactive(currentUser.uid);
      }
      
      // Reset user state
      setCurrentUser(null);
      setIsAdmin(false);
      setAssignedCourseIds([]);
      setCustomClaims(null);
      setLoading(false);
    } catch (error) {
      console.error('Logout error:', error);
      // If regular logout failed or timed out, try emergency logout
      await emergencyLogout();
      setLoading(false);
    }
  };
  
  // Emergency logout - use when normal logout fails
  const emergencyLogout = async () => {
    try {
      console.log('Attempting emergency logout');
      setLoading(true);
      
      // Mark tokens inactive in the background
      if (currentUser?.uid) {
        emergencyMarkTokensInactive(currentUser.uid);
      }
      
      // Call the emergency logout function
      await emergencyLogOut();
      
      // Reset user state
      setCurrentUser(null);
      setIsAdmin(false);
      setAssignedCourseIds([]);
      setCustomClaims(null);
    } catch (error) {
      console.error('Emergency logout error:', error);
    } finally {
      setLoading(false);
    }
  };

  const value = {
    currentUser,
    loading,
    logout,
    emergencyLogout,
    isAdmin,
    assignedCourseIds,
    customClaims,
    setUserAfterLogin
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
