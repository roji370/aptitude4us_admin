import React, { useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { checkExpiringSubscriptions, markExpiredSubscriptions } from '../services/subscriptionNotificationService';

/**
 * This component runs in the background and periodically checks 
 * for subscription events like:
 * - Subscriptions expiring soon (to send notifications)
 * - Subscriptions that have already expired (to update their status)
 */
const SubscriptionService: React.FC = () => {
  const { currentUser } = useAuth();
  const checkIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  useEffect(() => {
    // Only run if logged in as admin
    if (currentUser?.role === 'admin') {
      // Run once immediately
      const initialRun = async () => {
        try {
          console.log('Running initial subscription checks...');
          await markExpiredSubscriptions();
          await checkExpiringSubscriptions();
        } catch (error) {
          console.error('Error in subscription service initial run:', error);
        }
      };
      
      initialRun();
      
      // Then set up periodic checking (every hour)
      checkIntervalRef.current = setInterval(async () => {
        try {
          console.log('Running periodic subscription checks...');
          await markExpiredSubscriptions();
          await checkExpiringSubscriptions();
        } catch (error) {
          console.error('Error in subscription service:', error);
        }
      }, 60 * 60 * 1000); // Check every hour
    }
    
    return () => {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
        checkIntervalRef.current = null;
      }
    };
  }, [currentUser]);
  
  // This component doesn't render anything
  return null;
};

export default SubscriptionService; 