import React, { createContext, useContext, useState, useEffect } from 'react';
import { authApi } from '../service/api';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
    const [auth, setAuth] = useState({
        isAuthenticated: false,
        user: {
            id: '',
            role: '',
            wallet: 0,
        },
        isLoading: true, // Start with loading true
    });

    useEffect(() => {
        // Check if user is already authenticated (e.g., from localStorage/sessionStorage)
        const checkAuth = async () => {
            try {
                const data = await authApi.me();
                if (data.success && data.data.isAuthenticated) {
                    const res = data.data.user;
                    setAuth({
                        isAuthenticated: true,
                        user: {
                            id: res.id,
                            role: res.role,
                            wallet: res.wallet,
                        },
                        isLoading: false,
                    });
                } else {
                    setAuth({
                        isAuthenticated: false,
                        user: { id: '', role: '', wallet: 0 },
                        isLoading: false,
                    });
                }
            } catch (error) {
                // Don't redirect on API failure, just set as not authenticated
                console.log('Auth check failed:', error);
                setAuth({
                    isAuthenticated: false,
                    user: { id: '', role: '', wallet: 0 },
                    isLoading: false,
                });
            }
        };

        checkAuth();
    }, []); // Empty dependency array - only run once on mount

    const login = (id, role, wallet) => {
        setAuth({
            isAuthenticated: true,
            user: { id, role, wallet },
            isLoading: false,
        });
    };

    const logout = () => {
        setAuth({
            isAuthenticated: false,
            user: { id: '', role: '', wallet: 0 },
            isLoading: false,
        });
    };

    return (
        <AuthContext.Provider value={{ ...auth, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
