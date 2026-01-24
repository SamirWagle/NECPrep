import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { 
  auth, 
  googleProvider, 
  signInWithPopup, 
  signInWithRedirect,
  getRedirectResult,
  signOut, 
  onAuthStateChanged,
  parseAuthError,
  type User,
  type AuthErrorType
} from '../lib/firebase';

// Auth state interface
interface AuthState {
  user: User | null;
  loading: boolean;
  error: { type: AuthErrorType; message: string } | null;
}

// Auth context interface
interface AuthContextType extends AuthState {
  signInWithGoogle: () => Promise<void>;
  signInWithGoogleRedirect: () => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Custom hook to access auth context
export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: true,
    error: null
  });

  // Clear error
  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null }));
  }, []);

  // Check for redirect result on mount
  useEffect(() => {
    const checkRedirectResult = async () => {
      try {
        const result = await getRedirectResult(auth);
        if (result?.user) {
          setState(prev => ({ ...prev, user: result.user, loading: false }));
        }
      } catch (error) {
        console.error('Redirect result error:', error);
        setState(prev => ({ 
          ...prev, 
          error: parseAuthError(error),
          loading: false 
        }));
      }
    };
    
    checkRedirectResult();
  }, []);

  // Subscribe to auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setState(prev => ({
        ...prev,
        user,
        loading: false
      }));
    });

    return () => unsubscribe();
  }, []);

  // Sign in with Google popup (primary method)
  const signInWithGoogle = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error('Google sign-in error:', error);
      const parsedError = parseAuthError(error);
      setState(prev => ({ ...prev, error: parsedError, loading: false }));
      
      // If popup was blocked, suggest redirect method
      if (parsedError.type === 'popup-blocked') {
        throw error; // Re-throw to let UI handle redirect fallback
      }
    }
  }, []);

  // Sign in with Google redirect (fallback method)
  const signInWithGoogleRedirect = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      await signInWithRedirect(auth, googleProvider);
    } catch (error) {
      console.error('Google redirect error:', error);
      setState(prev => ({ 
        ...prev, 
        error: parseAuthError(error),
        loading: false 
      }));
    }
  }, []);

  // Logout
  const logout = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Logout error:', error);
      setState(prev => ({ 
        ...prev, 
        error: parseAuthError(error),
        loading: false 
      }));
    }
  }, []);

  const value: AuthContextType = {
    ...state,
    signInWithGoogle,
    signInWithGoogleRedirect,
    logout,
    clearError
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
