/**
 * Mobile Device ID utilities for React Native integration
 * This file provides device identification for mobile apps
 */

/**
 * Interface for mobile device information
 */
export interface MobileDeviceInfo {
  deviceId: string;
  platform: 'ios' | 'android';
  osVersion: string;
  appVersion: string;
  deviceModel?: string;
  deviceBrand?: string;
}

/**
 * Generate device ID for React Native apps
 * This would typically use react-native-device-info or similar libraries
 */
export const generateMobileDeviceId = async (): Promise<string> => {
  // In a real React Native app, you would use:
  // import DeviceInfo from 'react-native-device-info';
  // const uniqueId = await DeviceInfo.getUniqueId();
  // const deviceId = await DeviceInfo.getDeviceId();
  // const brand = await DeviceInfo.getBrand();
  // const model = await DeviceInfo.getModel();
  // const systemVersion = await DeviceInfo.getSystemVersion();
  
  // For web fallback, return browser fingerprint
  if (typeof window !== 'undefined') {
    const { generateDeviceFingerprint } = await import('./deviceFingerprint');
    return generateDeviceFingerprint();
  }
  
  // Server-side fallback
  return `mobile-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * Get mobile device information
 * This would be implemented differently for iOS and Android
 */
export const getMobileDeviceInfo = async (): Promise<MobileDeviceInfo> => {
  // In a real React Native app, you would use:
  // import DeviceInfo from 'react-native-device-info';
  // import { Platform } from 'react-native';
  
  // const deviceInfo: MobileDeviceInfo = {
  //   deviceId: await DeviceInfo.getUniqueId(),
  //   platform: Platform.OS as 'ios' | 'android',
  //   osVersion: await DeviceInfo.getSystemVersion(),
  //   appVersion: await DeviceInfo.getVersion(),
  //   deviceModel: await DeviceInfo.getModel(),
  //   deviceBrand: await DeviceInfo.getBrand()
  // };
  
  // For web/testing purposes, return mock data
  return {
    deviceId: await generateMobileDeviceId(),
    platform: 'android', // Default for web testing
    osVersion: '13.0',
    appVersion: '1.0.0',
    deviceModel: 'Web Browser',
    deviceBrand: 'Browser'
  };
};

/**
 * Validate mobile device ID
 */
export const validateMobileDeviceId = (storedDeviceId: string, currentDeviceId: string): boolean => {
  if (!storedDeviceId || !currentDeviceId) return false;
  
  // For mobile apps, device IDs should match exactly
  // Unlike web fingerprints, mobile device IDs are more stable
  return storedDeviceId === currentDeviceId;
};

/**
 * React Native integration example code
 * This shows how to integrate with a React Native student app
 */
export const reactNativeIntegrationExample = `
// Student App Integration Example
// Install: npm install react-native-device-info

import DeviceInfo from 'react-native-device-info';
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import functions from '@react-native-firebase/functions';

// Generate device ID for the current device
export const generateDeviceId = async () => {
  try {
    const uniqueId = await DeviceInfo.getUniqueId();
    const brand = await DeviceInfo.getBrand();
    const model = await DeviceInfo.getModel();
    const systemVersion = await DeviceInfo.getSystemVersion();
    
    // Create a composite device ID
    return \`\${uniqueId}-\${brand}-\${model}-\${systemVersion}\`.replace(/\\s/g, '');
  } catch (error) {
    console.error('Error generating device ID:', error);
    return \`fallback-\${Date.now()}\`;
  }
};

// Check device restriction before login
export const checkDeviceRestriction = async (userId, deviceId) => {
  try {
    const validateDevice = functions().httpsCallable('validateUserDevice');
    const result = await validateDevice({ userId, currentDeviceId: deviceId });
    
    return result.data;
  } catch (error) {
    console.error('Error validating device:', error);
    throw error;
  }
};

// Register device after successful login
export const registerDevice = async (userId, deviceId, deviceInfo) => {
  try {
    const registerUserDevice = functions().httpsCallable('registerUserDevice');
    const result = await registerUserDevice({ 
      userId, 
      deviceId, 
      deviceInfo 
    });
    
    return result.data;
  } catch (error) {
    console.error('Error registering device:', error);
    throw error;
  }
};

// Enhanced login with device validation
export const loginWithDeviceValidation = async (email, password) => {
  try {
    // Generate current device ID
    const deviceId = await generateDeviceId();
    const deviceInfo = await DeviceInfo.getDeviceName();
    
    // Sign in with Firebase Auth
    const userCredential = await auth().signInWithEmailAndPassword(email, password);
    const user = userCredential.user;
    
    // Check device restriction
    const deviceValidation = await checkDeviceRestriction(user.uid, deviceId);
    
    if (deviceValidation.restrictionEnabled && !deviceValidation.isValid) {
      if (deviceValidation.requiresRegistration) {
        // Register current device
        await registerDevice(user.uid, deviceId, deviceInfo);
        console.log('Device registered successfully');
      } else {
        // Device not authorized
        await auth().signOut();
        throw new Error('This account is restricted to a specific device. Please contact your administrator.');
      }
    }
    
    return user;
  } catch (error) {
    console.error('Login error:', error);
    throw error;
  }
};

// Usage in React Native component:
const LoginScreen = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  
  const handleLogin = async () => {
    try {
      setLoading(true);
      await loginWithDeviceValidation(email, password);
      // Navigate to main app
    } catch (error) {
      if (error.message.includes('DEVICE_RESTRICTED')) {
        Alert.alert(
          'Device Restricted',
          'This account is restricted to a specific device. Please contact your administrator.',
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert('Login Error', error.message);
      }
    } finally {
      setLoading(false);
    }
  };
  
  // ... rest of component
};
`;

/**
 * iOS Swift integration example
 */
export const iOSIntegrationExample = `
// iOS Swift Integration Example
// Add to your iOS project

import UIKit
import Firebase
import AdSupport
import AppTrackingTransparency

class DeviceManager {
    static func generateDeviceId() -> String {
        // Use IDFV (Identifier for Vendor) as primary identifier
        let idfv = UIDevice.current.identifierForVendor?.uuidString ?? ""
        
        // Combine with device model and system version for uniqueness
        let model = UIDevice.current.model
        let systemVersion = UIDevice.current.systemVersion
        
        let deviceId = "\\(idfv)-\\(model)-\\(systemVersion)".replacingOccurrences(of: " ", with: "")
        return deviceId
    }
    
    static func getDeviceInfo() -> [String: Any] {
        return [
            "deviceId": generateDeviceId(),
            "platform": "ios",
            "osVersion": UIDevice.current.systemVersion,
            "deviceModel": UIDevice.current.model,
            "deviceBrand": "Apple"
        ]
    }
    
    static func validateDeviceRestriction(userId: String, completion: @escaping (Result<[String: Any], Error>) -> Void) {
        let functions = Functions.functions()
        let validateDevice = functions.httpsCallable("validateUserDevice")
        
        let data = [
            "userId": userId,
            "currentDeviceId": generateDeviceId()
        ]
        
        validateDevice.call(data) { result, error in
            if let error = error {
                completion(.failure(error))
            } else if let data = result?.data as? [String: Any] {
                completion(.success(data))
            }
        }
    }
}

// Usage in login flow:
class AuthManager {
    static func loginWithDeviceValidation(email: String, password: String, completion: @escaping (Result<User, Error>) -> Void) {
        Auth.auth().signIn(withEmail: email, password: password) { authResult, error in
            if let error = error {
                completion(.failure(error))
                return
            }
            
            guard let user = authResult?.user else {
                completion(.failure(NSError(domain: "AuthError", code: -1, userInfo: [NSLocalizedDescriptionKey: "No user found"])))
                return
            }
            
            // Check device restriction
            DeviceManager.validateDeviceRestriction(userId: user.uid) { result in
                switch result {
                case .success(let validation):
                    let restrictionEnabled = validation["restrictionEnabled"] as? Bool ?? false
                    let isValid = validation["isValid"] as? Bool ?? true
                    let requiresRegistration = validation["requiresRegistration"] as? Bool ?? false
                    
                    if restrictionEnabled && !isValid {
                        if requiresRegistration {
                            // Register device
                            self.registerDevice(userId: user.uid) { registerResult in
                                switch registerResult {
                                case .success:
                                    completion(.success(user))
                                case .failure(let error):
                                    completion(.failure(error))
                                }
                            }
                        } else {
                            // Device not authorized
                            try? Auth.auth().signOut()
                            completion(.failure(NSError(domain: "DeviceRestricted", code: -1, userInfo: [NSLocalizedDescriptionKey: "This account is restricted to a specific device."])))
                        }
                    } else {
                        completion(.success(user))
                    }
                case .failure(let error):
                    completion(.failure(error))
                }
            }
        }
    }
    
    private static func registerDevice(userId: String, completion: @escaping (Result<Void, Error>) -> Void) {
        let functions = Functions.functions()
        let registerDevice = functions.httpsCallable("registerUserDevice")
        
        let deviceInfo = DeviceManager.getDeviceInfo()
        let data = [
            "userId": userId,
            "deviceId": deviceInfo["deviceId"] as? String ?? "",
            "deviceInfo": "\\(deviceInfo["deviceModel"] ?? "") (\\(deviceInfo["osVersion"] ?? ""))"
        ]
        
        registerDevice.call(data) { result, error in
            if let error = error {
                completion(.failure(error))
            } else {
                completion(.success(()))
            }
        }
    }
}
`;

/**
 * Android Kotlin integration example
 */
export const androidIntegrationExample = `
// Android Kotlin Integration Example
// Add to your Android project

import android.content.Context
import android.provider.Settings
import android.os.Build
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.functions.FirebaseFunctions
import java.security.MessageDigest

class DeviceManager(private val context: Context) {
    
    fun generateDeviceId(): String {
        // Use Android ID as primary identifier
        val androidId = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
        
        // Combine with device info for uniqueness
        val deviceInfo = "\${Build.BRAND}-\${Build.MODEL}-\${Build.VERSION.RELEASE}"
        val combined = "\$androidId-\$deviceInfo"
        
        // Hash the combined string for privacy
        return hashString(combined)
    }
    
    private fun hashString(input: String): String {
        val bytes = MessageDigest.getInstance("SHA-256").digest(input.toByteArray())
        return bytes.joinToString("") { "%02x".format(it) }
    }
    
    fun getDeviceInfo(): Map<String, Any> {
        return mapOf(
            "deviceId" to generateDeviceId(),
            "platform" to "android",
            "osVersion" to Build.VERSION.RELEASE,
            "deviceModel" to Build.MODEL,
            "deviceBrand" to Build.BRAND
        )
    }
    
    fun validateDeviceRestriction(userId: String, callback: (Result<Map<String, Any>>) -> Unit) {
        val functions = FirebaseFunctions.getInstance()
        val validateDevice = functions.getHttpsCallable("validateUserDevice")
        
        val data = hashMapOf(
            "userId" to userId,
            "currentDeviceId" to generateDeviceId()
        )
        
        validateDevice.call(data)
            .addOnSuccessListener { result ->
                val response = result.data as? Map<String, Any>
                if (response != null) {
                    callback(Result.success(response))
                } else {
                    callback(Result.failure(Exception("Invalid response")))
                }
            }
            .addOnFailureListener { exception ->
                callback(Result.failure(exception))
            }
    }
}

// Usage in login activity:
class AuthManager(private val context: Context) {
    private val deviceManager = DeviceManager(context)
    private val auth = FirebaseAuth.getInstance()
    
    fun loginWithDeviceValidation(
        email: String, 
        password: String, 
        callback: (Result<FirebaseUser>) -> Unit
    ) {
        auth.signInWithEmailAndPassword(email, password)
            .addOnSuccessListener { authResult ->
                val user = authResult.user
                if (user != null) {
                    deviceManager.validateDeviceRestriction(user.uid) { result ->
                        when (result.isSuccess) {
                            true -> {
                                val validation = result.getOrNull()!!
                                val restrictionEnabled = validation["restrictionEnabled"] as? Boolean ?: false
                                val isValid = validation["isValid"] as? Boolean ?: true
                                val requiresRegistration = validation["requiresRegistration"] as? Boolean ?: false
                                
                                if (restrictionEnabled && !isValid) {
                                    if (requiresRegistration) {
                                        registerDevice(user.uid) { registerResult ->
                                            if (registerResult.isSuccess) {
                                                callback(Result.success(user))
                                            } else {
                                                callback(Result.failure(registerResult.exceptionOrNull()!!))
                                            }
                                        }
                                    } else {
                                        auth.signOut()
                                        callback(Result.failure(Exception("This account is restricted to a specific device.")))
                                    }
                                } else {
                                    callback(Result.success(user))
                                }
                            }
                            false -> callback(Result.failure(result.exceptionOrNull()!!))
                        }
                    }
                } else {
                    callback(Result.failure(Exception("No user found")))
                }
            }
            .addOnFailureListener { exception ->
                callback(Result.failure(exception))
            }
    }
    
    private fun registerDevice(userId: String, callback: (Result<Unit>) -> Unit) {
        val functions = FirebaseFunctions.getInstance()
        val registerDevice = functions.getHttpsCallable("registerUserDevice")
        
        val deviceInfo = deviceManager.getDeviceInfo()
        val data = hashMapOf(
            "userId" to userId,
            "deviceId" to deviceInfo["deviceId"],
            "deviceInfo" to "\${deviceInfo["deviceBrand"]} \${deviceInfo["deviceModel"]} (Android \${deviceInfo["osVersion"]})"
        )
        
        registerDevice.call(data)
            .addOnSuccessListener {
                callback(Result.success(Unit))
            }
            .addOnFailureListener { exception ->
                callback(Result.failure(exception))
            }
    }
}
`;
