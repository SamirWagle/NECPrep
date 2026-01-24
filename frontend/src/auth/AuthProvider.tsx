import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { User, Session, AuthError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

// Error types for better UX
export type AuthErrorType = 
  | 'popup-blocked' 
  | 'network-error' 
  | 'cancelled' 
  | 'account-exists' 
  | 'unknown';

// Parse Supabase auth errors into user-friendly types
function parseAuthError(error: AuthError | Error): { type: AuthErrorType; message: string } {
  const message = error.message.toLowerCase();
  
  if (message.includes('popup') || message.includes('blocked')) {
    return { type: 'popup-blocked', message: 'Popup was blocked. Please allow popups and try again.' };
  }
  if (message.includes('network') || message.includes('fetch')) {
    return { type: 'network-error', message: 'Network error. Please check your connection.' };
  }
  if (message.includes('cancel') || message.includes('closed')) {
    return { type: 'cancelled', message: 'Sign-in was cancelled.' };
  }
  if (message.includes('account') && message.includes('exists')) {
    return { type: 'account-exists', message: 'An account already exists with this email.' };
  }
  
  return { type: 'unknown', message: error.message || 'An unexpected error occurred.' };
}

// Auth state interface
interface AuthState {
  user: User | null;
  session: Session | null;
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
    session: null,
    loading: true,
    error: null
  });

  // Clear error
  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null }));
  }, []);

  // Initialize auth state
  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setState(prev => ({
        ...prev,
        user: session?.user ?? null,
        session,
        loading: false,
      }));
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('Auth state changed:', event);
        
        setState(prev => ({
          ...prev,
          user: session?.user ?? null,
          session,
          loading: false,
        }));

        // Handle sign in - ensure profile exists
        if (event === 'SIGNED_IN' && session?.user) {
          const { error } = await supabase
            .from('profiles')
            .upsert({
              id: session.user.id,
              email: session.user.email,
              full_name: session.user.user_metadata?.full_name || session.user.user_metadata?.name,
              avatar_url: session.user.user_metadata?.avatar_url,
              updated_at: new Date().toISOString(),
            }, {
              onConflict: 'id'
            });

          if (error) {
            console.error('Error updating profile:', error);
          }
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Sign in with Google (OAuth)
  const signInWithGoogle = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/app`,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });

      if (error) throw error;
    } catch (error) {
      console.error('Google sign-in error:', error);
      const parsedError = parseAuthError(error as AuthError);
      setState(prev => ({ ...prev, error: parsedError, loading: false }));
    }
  }, []);

  // Sign in with Google redirect (same as above for Supabase)
  const signInWithGoogleRedirect = useCallback(async () => {
    // Supabase OAuth always uses redirect, so this is the same
    await signInWithGoogle();
  }, [signInWithGoogle]);

  // Logout
  const logout = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      
      setState({
        user: null,
        session: null,
        loading: false,
        error: null,
      });
    } catch (error) {
      console.error('Logout error:', error);
      setState(prev => ({ 
        ...prev, 
        error: parseAuthError(error as Error),
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
