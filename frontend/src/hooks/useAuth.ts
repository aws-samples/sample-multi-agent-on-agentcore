import { useState, useCallback } from "react";
import type { User, AuthState } from "../types";
import { login as apiLogin } from "../api/auth";

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    currentUser: null,
    token: null,
    isAuthenticated: false,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = useCallback(async (username: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiLogin(username);
      setState({
        currentUser: res.user,
        token: res.token,
        isAuthenticated: true,
      });
    } catch (err) {
      setError((err as Error).message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    setState({
      currentUser: null,
      token: null,
      isAuthenticated: false,
    });
    setError(null);
  }, []);

  return {
    ...state,
    isLoading,
    error,
    login,
    logout,
  };
}
